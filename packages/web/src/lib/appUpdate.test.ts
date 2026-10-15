import { describe, it, expect } from 'vitest';
import {
  parseSemver,
  isNewerVersion,
  getPlatformAsset,
  GitHubReleaseAsset,
} from './appUpdate.js';

describe('appUpdate utilities', () => {
  describe('parseSemver', () => {
    it('parses standard semver strings with and without v prefix', () => {
      expect(parseSemver('0.3.1')).toEqual({ major: 0, minor: 3, patch: 1, prerelease: '' });
      expect(parseSemver('v0.3.1')).toEqual({ major: 0, minor: 3, patch: 1, prerelease: '' });
      expect(parseSemver('v1.0.0')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: '' });
    });

    it('parses prerelease tags', () => {
      expect(parseSemver('v0.3.2-beta.1')).toEqual({
        major: 0,
        minor: 3,
        patch: 2,
        prerelease: 'beta.1',
      });
    });

    it('returns null for invalid versions', () => {
      expect(parseSemver('')).toBeNull();
      expect(parseSemver('invalid')).toBeNull();
    });
  });

  describe('isNewerVersion', () => {
    it('correctly compares major versions', () => {
      expect(isNewerVersion('v1.0.0', '0.3.1')).toBe(true);
      expect(isNewerVersion('0.2.0', '1.0.0')).toBe(false);
    });

    it('correctly compares minor versions', () => {
      expect(isNewerVersion('v0.4.0', '0.3.1')).toBe(true);
      expect(isNewerVersion('0.3.0', '0.3.1')).toBe(false);
    });

    it('correctly compares patch versions', () => {
      expect(isNewerVersion('v0.3.2', '0.3.1')).toBe(true);
      expect(isNewerVersion('0.3.1', '0.3.1')).toBe(false);
      expect(isNewerVersion('v0.2.2', '0.3.1')).toBe(false);
    });

    it('treats final release as newer than prerelease with same numbers', () => {
      expect(isNewerVersion('v0.3.2', '0.3.2-rc.1')).toBe(true);
      expect(isNewerVersion('v0.3.2-rc.1', '0.3.2')).toBe(false);
    });
  });

  describe('getPlatformAsset', () => {
    const mockAssets: GitHubReleaseAsset[] = [
      {
        name: 'SP-Kickstack_0.3.2_aarch64.dmg',
        browser_download_url: 'https://github.com/releases/SP-Kickstack_0.3.2_aarch64.dmg',
        size: 104857600,
        content_type: 'application/octet-stream',
      },
      {
        name: 'SP-Kickstack_0.3.2_x64-setup.exe',
        browser_download_url: 'https://github.com/releases/SP-Kickstack_0.3.2_x64-setup.exe',
        size: 94371840,
        content_type: 'application/octet-stream',
      },
      {
        name: 'sp-kickstack_0.3.2_amd64.deb',
        browser_download_url: 'https://github.com/releases/sp-kickstack_0.3.2_amd64.deb',
        size: 83886080,
        content_type: 'application/octet-stream',
      },
    ];

    it('picks dmg for Mac userAgent', () => {
      const macUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
      const asset = getPlatformAsset(mockAssets, macUA);
      expect(asset?.name).toContain('.dmg');
    });

    it('picks exe or msi for Windows userAgent', () => {
      const winUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      const asset = getPlatformAsset(mockAssets, winUA);
      expect(asset?.name).toContain('.exe');
    });

    it('picks deb for Linux userAgent', () => {
      const linuxUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
      const asset = getPlatformAsset(mockAssets, linuxUA);
      expect(asset?.name).toContain('.deb');
    });

    it('falls back to null if no assets or no match', () => {
      expect(getPlatformAsset([])).toBeNull();
    });
  });
});
