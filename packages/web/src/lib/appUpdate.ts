import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { APP_VERSION } from '@sp-kickstack/shared';
import { isTauri } from './api.js';

export const GITHUB_REPO = 'sopheaksem9999/sp-kickstack';
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
export const DISMISSED_UPDATE_KEY = 'sp_kickstack_dismissed_update';

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

/**
 * Safely parse a semantic version string (e.g. "v0.3.2", "0.3.1-beta.1")
 */
export function parseSemver(version: string): Semver | null {
  if (!version || typeof version !== 'string') return null;
  const cleaned = version.trim().replace(/^[vV]/, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || '',
  };
}

/**
 * Returns true if remoteTag is strictly newer than currentVersion.
 */
export function isNewerVersion(remoteTag: string, currentVersion: string): boolean {
  const remote = parseSemver(remoteTag);
  const current = parseSemver(currentVersion);

  if (!remote || !current) return false;

  if (remote.major !== current.major) {
    return remote.major > current.major;
  }
  if (remote.minor !== current.minor) {
    return remote.minor > current.minor;
  }
  if (remote.patch !== current.patch) {
    return remote.patch > current.patch;
  }

  // If numeric parts are equal:
  // e.g. "0.3.1" (no prerelease) is newer than "0.3.1-rc.1" (has prerelease)
  if (!remote.prerelease && current.prerelease) {
    return true;
  }
  if (remote.prerelease && !current.prerelease) {
    return false;
  }

  // Both have prereleases, compare lexicographically
  if (remote.prerelease && current.prerelease) {
    return remote.prerelease.localeCompare(current.prerelease, undefined, { numeric: true }) > 0;
  }

  return false;
}

/**
 * Find the most suitable download asset for the current OS platform
 */
export function getPlatformAsset(
  assets: GitHubReleaseAsset[],
  customUA?: string
): GitHubReleaseAsset | null {
  if (!assets || assets.length === 0) return null;

  const ua = (customUA || (typeof navigator !== 'undefined' ? navigator.userAgent : '')).toLowerCase();
  const isMac = ua.includes('mac');
  const isWindows = ua.includes('win');
  const isLinux = ua.includes('linux');

  if (isMac) {
    // Look for DMG first, then tar.gz / zip
    const dmg = assets.find((a) => a.name.endsWith('.dmg'));
    if (dmg) return dmg;
    const appArchive = assets.find((a) => a.name.includes('.app.tar.gz'));
    if (appArchive) return appArchive;
  } else if (isWindows) {
    // Look for exe or msi
    const exe = assets.find((a) => a.name.endsWith('.exe'));
    if (exe) return exe;
    const msi = assets.find((a) => a.name.endsWith('.msi'));
    if (msi) return msi;
  } else if (isLinux) {
    // Look for deb or AppImage
    const deb = assets.find((a) => a.name.endsWith('.deb'));
    if (deb) return deb;
    const appImage = assets.find((a) => a.name.endsWith('.appimage'));
    if (appImage) return appImage;
  }

  // Fallback to any DMG, EXE, or DEB
  return (
    assets.find(
      (a) =>
        a.name.endsWith('.dmg') ||
        a.name.endsWith('.exe') ||
        a.name.endsWith('.msi') ||
        a.name.endsWith('.deb')
    ) || null
  );
}

/**
 * Safely open external URL in the default system browser
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri && typeof window !== 'undefined') {
    try {
      // In Tauri v2, opening links can use plugin-shell or window.open
      const tauri = (window as any).__TAURI__;
      if (tauri?.shell?.open) {
        await tauri.shell.open(url);
        return;
      }
    } catch {
      // Fallback below
    }
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Fetch latest release from GitHub API
 */
export async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        // No releases found yet
        return null;
      }
      throw new Error(`GitHub API returned status ${res.status}`);
    }

    const data = (await res.json()) as GitHubRelease;
    return data;
  } catch (err) {
    console.warn('[appUpdate] Failed to fetch latest release from GitHub:', err);
    return null;
  }
}

/**
 * Main React Hook for Desktop & Web App Update Checking
 */
export function useAppUpdate() {
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(DISMISSED_UPDATE_KEY);
  });

  const query = useQuery({
    queryKey: ['github-app-update'],
    queryFn: fetchLatestRelease,
    staleTime: 1000 * 60 * 15, // 15 minutes
    refetchOnWindowFocus: false,
  });

  const release = query.data || null;
  const latestTag = release?.tag_name || '';
  const latestVersion = latestTag.replace(/^[vV]/, '');
  const hasUpdate = Boolean(latestTag && isNewerVersion(latestTag, APP_VERSION));

  const isDismissed = Boolean(hasUpdate && dismissedVersion === latestTag);

  const platformAsset = useMemo(() => {
    return release?.assets ? getPlatformAsset(release.assets) : null;
  }, [release?.assets]);

  const dismissUpdate = useCallback((versionToDismiss: string) => {
    setDismissedVersion(versionToDismiss);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISSED_UPDATE_KEY, versionToDismiss);
    }
  }, []);

  const checkForUpdates = useCallback(
    async (interactive = true) => {
      if (interactive) {
        toast.info('Checking for updates...', { duration: 2000 });
      }

      const res = await query.refetch();
      const latest = res.data;

      if (interactive) {
        if (!latest) {
          toast.error('Unable to fetch latest release information.');
          return;
        }

        if (isNewerVersion(latest.tag_name, APP_VERSION)) {
          toast.success(`New update available: ${latest.tag_name}!`, {
            description: `You are currently on v${APP_VERSION}.`,
          });
        } else {
          toast.success('SP-Kickstack is up to date!', {
            description: `Current version v${APP_VERSION} is the latest available.`,
          });
        }
      }
    },
    [query]
  );

  return {
    isChecking: query.isFetching,
    hasUpdate,
    isDismissed,
    currentVersion: APP_VERSION,
    latestVersion,
    latestTag,
    release,
    platformAsset,
    dismissUpdate,
    checkForUpdates,
  };
}
