import fs from 'fs';
import path from 'path';
import { ProjectService } from './projectService.js';
import { assertSafeRef, resolveInRepo, tryGit } from '../lib/safeExec.js';

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
  availableBranches?: string[];
  error?: string;
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
    targetBranch = 'HEAD'
  ): GitReviewSummary {
    assertSafeRef(targetBranch);
    const project = this.projectService.getProject(projectName);
    if (!project) {
      throw new Error(`Project ${projectName} not found`);
    }

    const repoPath = project.repo_path?.trim() || '';
    if (!repoPath || !fs.existsSync(repoPath)) {
      return {
        project: projectName,
        repoPath: repoPath || '(no repo path)',
        currentBranch: project.base_branch || 'main',
        targetBranch,
        totalAdditions: 0,
        totalDeletions: 0,
        changedFiles: [],
        recentCommits: [],
        clean: true,
        error: repoPath ? `Repository path does not exist on disk: ${repoPath}` : 'No repository path configured',
      };
    }

    const isGit = tryGit(repoPath, ['rev-parse', '--git-dir']) !== null;
    if (!isGit) {
      return {
        project: projectName,
        repoPath,
        currentBranch: project.base_branch || 'main',
        targetBranch,
        totalAdditions: 0,
        totalDeletions: 0,
        changedFiles: [],
        recentCommits: [],
        clean: true,
        error: `Directory is not a git repository: ${repoPath}`,
      };
    }

    const currentBranch = tryGit(repoPath, ['branch', '--show-current'])?.trim() || 'develop';

    // Check if target branch exists locally or in remotes; otherwise compare against HEAD
    const compareTarget =
      tryGit(repoPath, ['rev-parse', '--verify', '--quiet', targetBranch]) !== null ? targetBranch : 'HEAD';

    // 1. Get numstat (additions, deletions, filenames)
    let totalAdditions = 0;
    let totalDeletions = 0;
    const changedFiles: ChangedFile[] = [];

    {
      const numstat = (
        compareTarget === 'HEAD'
          ? tryGit(repoPath, ['diff', '--numstat', 'HEAD'])
          : tryGit(repoPath, ['diff', '--numstat', `${compareTarget}...HEAD`]) ??
            tryGit(repoPath, ['diff', '--numstat', compareTarget]) ??
            tryGit(repoPath, ['diff', '--numstat'])
      )?.trim();

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
    }

    // Also check uncommitted/untracked status
    {
      const statusOut = tryGit(repoPath, ['status', '--porcelain'])?.trim();

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
    }

    // 2. Recent Commits
    const recentCommits: GitCommitInfo[] = [];
    {
      const logOut = (
        tryGit(repoPath, ['log', '-n', '8', '--pretty=format:%h|%s|%an|%cr']) ??
        tryGit(repoPath, ['log', '-n', '5', '--oneline'])
      )?.trim();

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
    }

    // Collect available local branches for comparator switching
    const branchList = tryGit(repoPath, ['branch', '--list', '--format=%(refname:short)'])?.trim();
    const availableBranches = branchList
      ? Array.from(new Set(branchList.split('\n').map((b) => b.trim()).filter(Boolean)))
      : [];

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
      availableBranches,
    };
  }

  /**
   * Get file diff content for side-by-side or unified review
   */
  public getFileDiff(
    projectName: string,
    filePath: string,
    targetBranch = 'HEAD'
  ): FileDiffResult {
    assertSafeRef(targetBranch);
    const project = this.projectService.getProject(projectName);
    const repoPath = project?.repo_path || '';
    if (!repoPath || !fs.existsSync(repoPath)) {
      return {
        path: filePath,
        status: 'unchanged',
        originalContent: '',
        modifiedContent: '',
        diffLines: [],
        additions: 0,
        deletions: 0,
      };
    }
    const { fullPath, relPath } = resolveInRepo(repoPath, filePath);

    let modifiedContent = '';

    // Read original content from targetBranch (or HEAD for uncommitted working tree diff)
    const originalContent =
      targetBranch === 'HEAD'
        ? tryGit(repoPath, ['show', `HEAD:${relPath}`]) ?? ''
        : tryGit(repoPath, ['show', `${targetBranch}:${relPath}`]) ?? '';

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

    const rawDiff =
      targetBranch === 'HEAD'
        ? tryGit(repoPath, ['diff', 'HEAD', '--', relPath]) ?? tryGit(repoPath, ['diff', '--', relPath])
        : tryGit(repoPath, ['diff', `${targetBranch}...HEAD`, '--', relPath]) ??
          tryGit(repoPath, ['diff', targetBranch, '--', relPath]) ??
          tryGit(repoPath, ['diff', '--', relPath]);

    if (rawDiff !== null) {
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
    const project = this.projectService.getProject(projectName);
    const repoPath = project?.repo_path || '';
    if (!repoPath || !fs.existsSync(repoPath)) {
      return {
        name: projectName,
        path: '.',
        type: 'directory',
        children: [],
      };
    }

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
    const project = this.projectService.getProject(projectName);
    const repoPath = project?.repo_path || '';
    if (!repoPath || !fs.existsSync(repoPath)) {
      return { path: filePath, content: `Error: Repository path does not exist on disk (${repoPath || 'none'})`, size: 0 };
    }
    const { fullPath } = resolveInRepo(repoPath, filePath);

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
