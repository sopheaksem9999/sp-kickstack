import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ProjectService } from './projectService.js';

export interface ChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitReviewSummary {
  project: string;
  repoPath: string;
  currentBranch: string;
  targetBranch: string;
  totalAdditions: number;
  totalDeletions: number;
  changedFiles: ChangedFile[];
  recentCommits: GitCommitInfo[];
  clean: boolean;
}

export interface DiffLine {
  type: 'add' | 'del' | 'normal' | 'header';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface FileDiffResult {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'unchanged';
  originalContent: string;
  modifiedContent: string;
  diffLines: DiffLine[];
  additions: number;
  deletions: number;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileTreeNode[];
}

export class GitReviewService {
  constructor(private projectService: ProjectService) {}

  private resolveRepo(projectName: string): string {
    const project = this.projectService.getProject(projectName);
    if (!project || !project.repo_path) {
      throw new Error(`Project ${projectName} not found or has no repo path`);
    }
    if (!fs.existsSync(project.repo_path)) {
      throw new Error(`Project repository path does not exist: ${project.repo_path}`);
    }
    return project.repo_path;
  }

  /**
   * Get overall git review summary between current branch and target branch
   */
  public getReviewSummary(
    projectName: string,
    targetBranch = 'main'
  ): GitReviewSummary {
    const repoPath = this.resolveRepo(projectName);

    let currentBranch = 'develop';
    try {
      currentBranch = execSync('git branch --show-current', {
        cwd: repoPath,
        encoding: 'utf8',
      }).trim() || 'develop';
    } catch {
      // fallback
    }

    // Check if target branch exists locally or in remotes
    let compareTarget = targetBranch;
    try {
      execSync(`git rev-parse --verify ${targetBranch} 2>/dev/null`, { cwd: repoPath });
    } catch {
      // If target branch doesn't exist, compare against HEAD~1 or HEAD
      compareTarget = 'HEAD';
    }

    // 1. Get numstat (additions, deletions, filenames)
    let totalAdditions = 0;
    let totalDeletions = 0;
    const changedFiles: ChangedFile[] = [];

    try {
      const numstatCmd =
        compareTarget === 'HEAD'
          ? 'git diff --numstat HEAD'
          : `git diff --numstat ${compareTarget}...HEAD 2>/dev/null || git diff --numstat ${compareTarget} 2>/dev/null || git diff --numstat`;

      const numstat = execSync(numstatCmd, {
        cwd: repoPath,
        encoding: 'utf8',
      }).trim();

      if (numstat) {
        for (const line of numstat.split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const adds = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
            const dels = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
            const filePath = parts[2].trim();

            totalAdditions += adds;
            totalDeletions += dels;

            changedFiles.push({
              path: filePath,
              status: adds > 0 && dels === 0 ? 'added' : dels > 0 && adds === 0 ? 'deleted' : 'modified',
              additions: adds,
              deletions: dels,
            });
          }
        }
      }
    } catch {
      // Ignore git diff error
    }

    // Also check uncommitted/untracked status
    try {
      const statusOut = execSync('git status --porcelain', {
        cwd: repoPath,
        encoding: 'utf8',
      }).trim();

      if (statusOut) {
        for (const line of statusOut.split('\n')) {
          const code = line.slice(0, 2).trim();
          const filePath = line.slice(3).trim();

          const existing = changedFiles.find((f) => f.path === filePath);
          if (!existing) {
            changedFiles.push({
              path: filePath,
              status: code.includes('A') || code.includes('?') ? 'added' : code.includes('D') ? 'deleted' : 'modified',
              additions: 1,
              deletions: 0,
            });
            totalAdditions += 1;
          }
        }
      }
    } catch {
      // Ignore
    }

    // 2. Recent Commits
    const recentCommits: GitCommitInfo[] = [];
    try {
      const logOut = execSync(
        'git log -n 8 --pretty=format:"%h|%s|%an|%cr" 2>/dev/null || git log -n 5 --oneline',
        { cwd: repoPath, encoding: 'utf8' }
      ).trim();

      if (logOut) {
        for (const line of logOut.split('\n')) {
          const [hash, message, author, date] = line.split('|');
          if (hash && message) {
            recentCommits.push({
              hash,
              message,
              author: author || 'Developer',
              date: date || 'recently',
            });
          }
        }
      }
    } catch {
      // Ignore
    }

    return {
      project: projectName,
      repoPath,
      currentBranch,
      targetBranch,
      totalAdditions,
      totalDeletions,
      changedFiles,
      recentCommits,
      clean: changedFiles.length === 0,
    };
  }

  /**
   * Get file diff content for side-by-side or unified review
   */
  public getFileDiff(
    projectName: string,
    filePath: string,
    targetBranch = 'main'
  ): FileDiffResult {
    const repoPath = this.resolveRepo(projectName);
    const fullPath = path.join(repoPath, filePath);

    let originalContent = '';
    let modifiedContent = '';

    // Read original content from targetBranch
    try {
      originalContent = execSync(`git show ${targetBranch}:${filePath} 2>/dev/null`, {
        cwd: repoPath,
        encoding: 'utf8',
      });
    } catch {
      originalContent = '';
    }

    // Read current modified content
    try {
      if (fs.existsSync(fullPath)) {
        modifiedContent = fs.readFileSync(fullPath, 'utf8');
      } else {
        modifiedContent = '';
      }
    } catch {
      modifiedContent = '';
    }

    // Parse git diff output into line chunks
    const diffLines: DiffLine[] = [];
    let additions = 0;
    let deletions = 0;

    try {
      const rawDiff = execSync(
        `git diff ${targetBranch}...HEAD -- "${filePath}" 2>/dev/null || git diff -- "${filePath}" 2>/dev/null`,
        { cwd: repoPath, encoding: 'utf8' }
      );

      let oldLine = 1;
      let newLine = 1;

      for (const line of rawDiff.split('\n')) {
        if (line.startsWith('@@')) {
          // Hunk header e.g. @@ -1,5 +1,6 @@
          const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match) {
            oldLine = parseInt(match[1], 10);
            newLine = parseInt(match[2], 10);
          }
          diffLines.push({ type: 'header', content: line });
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++;
          diffLines.push({
            type: 'add',
            newLineNumber: newLine++,
            content: line.slice(1),
          });
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
          diffLines.push({
            type: 'del',
            oldLineNumber: oldLine++,
            content: line.slice(1),
          });
        } else if (!line.startsWith('diff ') && !line.startsWith('index ')) {
          diffLines.push({
            type: 'normal',
            oldLineNumber: oldLine++,
            newLineNumber: newLine++,
            content: line.startsWith(' ') ? line.slice(1) : line,
          });
        }
      }
    } catch {
      // If diff failed, create simple line diff from content
    }

    let status: 'modified' | 'added' | 'deleted' | 'unchanged' = 'modified';
    if (!originalContent && modifiedContent) status = 'added';
    else if (originalContent && !modifiedContent) status = 'deleted';
    else if (originalContent === modifiedContent) status = 'unchanged';

    return {
      path: filePath,
      status,
      originalContent,
      modifiedContent,
      diffLines,
      additions,
      deletions,
    };
  }

  /**
   * Get recursive file tree of the project repo
   */
  public getFileTree(projectName: string, maxDepth = 4): FileTreeNode {
    const repoPath = this.resolveRepo(projectName);

    const ignoredNames = new Set([
      '.git',
      'node_modules',
      'dist',
      'build',
      '.next',
      '.output',
      '.DS_Store',
      'coverage',
      '.turbo',
      'target',
    ]);

    const buildTree = (currentDir: string, relativePath: string, depth: number): FileTreeNode => {
      const name = path.basename(currentDir);
      const isDir = fs.statSync(currentDir).isDirectory();

      if (!isDir) {
        return {
          name,
          path: relativePath,
          type: 'file',
          size: fs.statSync(currentDir).size,
        };
      }

      const node: FileTreeNode = {
        name,
        path: relativePath,
        type: 'directory',
        children: [],
      };

      if (depth >= maxDepth) return node;

      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (ignoredNames.has(entry.name)) continue;

          const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          const childFull = path.join(currentDir, entry.name);

          try {
            node.children?.push(buildTree(childFull, childRel, depth + 1));
          } catch {
            // Ignore unreadable entries
          }
        }
      } catch {
        // Ignore read errors
      }

      // Sort directories first, then alphabetical
      node.children?.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return node;
    };

    return buildTree(repoPath, '', 0);
  }

  /**
   * Get raw file content for viewing in the editor
   */
  public getFileContent(projectName: string, filePath: string): { path: string; content: string; size: number } {
    const repoPath = this.resolveRepo(projectName);
    const fullPath = path.join(repoPath, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(fullPath);
    if (stat.size > 2 * 1024 * 1024) {
      return { path: filePath, content: '// File exceeds 2MB limit for in-app preview.', size: stat.size };
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    return { path: filePath, content, size: stat.size };
  }
}
