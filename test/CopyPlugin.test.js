import path from 'path';

import CopyPlugin from '../src/index';

import { MockCompiler } from './utils/mocks';
import { run, runEmit, runChange } from './utils/run';

const BUILD_DIR = path.join(__dirname, 'build');
const HELPER_DIR = path.join(__dirname, 'helpers');

describe('apply function', () => {
  describe('basic', () => {
    it('should works with multiple patterns with same "from"', (done) => {
      runEmit({
        expectedAssetKeys: ['first/file.txt', 'second/file.txt'],
        patterns: [
          {
            from: 'file.txt',
            to: 'first/file.txt',
          },
          {
            from: 'file.txt',
            to: 'second/file.txt',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('should works with multiple patterns as String', (done) => {
      runEmit({
        expectedAssetKeys: ['binextension.bin', 'file.txt', 'noextension'],
        patterns: ['binextension.bin', 'file.txt', 'noextension'],
      })
        .then(done)
        .catch(done);
    });

    it('should works with multiple patterns as Object', (done) => {
      runEmit({
        expectedAssetKeys: ['binextension.bin', 'file.txt', 'noextension'],
        patterns: [
          {
            from: 'binextension.bin',
          },
          {
            from: 'file.txt',
          },
          {
            from: 'noextension',
          },
        ],
      })
        .then(done)
        .catch(done);
    });
  });

  describe('difference path segment separation', () => {
    it('should work with linux path segment separation path when "from" is glob', (done) => {
      runEmit({
        expectedAssetKeys: ['directory/nested/nestedfile.txt'],
        patterns: [
          {
            from: 'directory/nested/*',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('should work with windows path segment separation path when "from" is glob', (done) => {
      runEmit({
        expectedAssetKeys: ['directory/nested/nestedfile.txt'],
        patterns: [
          {
            from: {
              glob: 'directory\\nested\\*',
            },
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('should work with mixed path segment separation path when "from" is glob', (done) => {
      runEmit({
        expectedAssetKeys: ['directory/nested/nestedfile.txt'],
        patterns: [
          {
            from: {
              glob: 'directory/nested\\*',
            },
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('should exclude path with linux path segment separators', (done) => {
      runEmit({
        expectedAssetKeys: [
          '[!]/hello.txt',
          '[special?directory]/(special-*file).txt',
          '[special?directory]/directoryfile.txt',
          '[special?directory]/nested/nestedfile.txt',
          'dir (86)/file.txt',
          'dir (86)/nesteddir/deepnesteddir/deepnesteddir.txt',
          'dir (86)/nesteddir/nestedfile.txt',
        ],
        patterns: [
          {
            from: '!(directory)/**/*.txt',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('should exclude path with windows path segment separators', (done) => {
      runEmit({
        expectedAssetKeys: [
          '[!]/hello.txt',
          '[special?directory]/(special-*file).txt',
          '[special?directory]/directoryfile.txt',
          '[special?directory]/nested/nestedfile.txt',
          'dir (86)/file.txt',
          'dir (86)/nesteddir/deepnesteddir/deepnesteddir.txt',
          'dir (86)/nesteddir/nestedfile.txt',
        ],
        patterns: [
          {
            from: '!(directory)\\**\\*.txt',
          },
        ],
      })
        .then(done)
        .catch(done);
    });
  });

  describe('errors', () => {
    it('should not throw an error if no patterns are passed', (done) => {
      runEmit({
        expectedAssetKeys: [],
        patterns: undefined, // eslint-disable-line no-undefined
      })
        .then(done)
        .catch(done);
    });

    it('should throw an error if the patterns are an object', () => {
      const createPluginWithObject = () => {
        // eslint-disable-next-line no-new
        new CopyPlugin({});
      };

      expect(createPluginWithObject).toThrow(Error);
    });

    it('should throw an error if the patterns are null', () => {
      const createPluginWithNull = () => {
        // eslint-disable-next-line no-new
        new CopyPlugin(null);
      };

      expect(createPluginWithNull).toThrow(Error);
    });

    it('should throws an error if the "from" path is an empty string', () => {
      const createPluginWithNull = () => {
        // eslint-disable-next-line no-new
        new CopyPlugin({
          from: '',
        });
      };

      expect(createPluginWithNull).toThrow(Error);
    });
  });

  describe('dev server', () => {
    it('should work with absolute to if outpath is defined with webpack-dev-server', (done) => {
      runEmit({
        compiler: new MockCompiler({
          outputPath: '/',
          devServer: {
            outputPath: BUILD_DIR,
          },
        }),
        expectedAssetKeys: ['file.txt'],
        patterns: [
          {
            from: 'file.txt',
            to: BUILD_DIR,
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it("should throw an error when output path isn't defined with webpack-dev-server", (done) => {
      runEmit({
        compiler: new MockCompiler({
          outputPath: '/',
        }),
        skipAssetsTesting: true,
        expectedErrors: [
          new Error(
            'using older versions of webpack-dev-server, devServer.outputPath must be defined to write to absolute paths'
          ),
        ],
        patterns: [
          {
            from: 'file.txt',
            to: BUILD_DIR,
          },
        ],
      })
        .then(done)
        .catch(done);
    });
  });

  describe('watch mode', () => {
    it('should add the file to the watch list when "from" is a file', (done) => {
      run({
        patterns: [
          {
            from: 'file.txt',
          },
        ],
      })
        .then((compilation) => {
          const absFrom = path.join(HELPER_DIR, 'file.txt');

          expect(Array.from(compilation.fileDependencies).sort()).toEqual(
            [absFrom].sort()
          );
        })
        .then(done)
        .catch(done);
    });

    it('should add a directory to the watch list when "from" is a directory', (done) => {
      run({
        patterns: [
          {
            from: 'directory',
          },
        ],
      })
        .then((compilation) => {
          const absFrom = path.resolve(HELPER_DIR, 'directory');

          expect(Array.from(compilation.contextDependencies).sort()).toEqual(
            [absFrom].sort()
          );
        })
        .then(done)
        .catch(done);
    });

    it('should add a directory to the watch list when "from" is a glob', (done) => {
      run({
        patterns: [
          {
            from: 'directory/**/*',
          },
        ],
      })
        .then((compilation) => {
          expect(
            Array.from(compilation.contextDependencies)
              .map((contextDependency) => contextDependency)
              .sort()
          ).toEqual([path.join(HELPER_DIR, 'directory')].sort());
        })
        .then(done)
        .catch(done);
    });

    it('should not add the directory to the watch list when glob is a file', (done) => {
      run({
        patterns: [
          {
            from: {
              glob: 'directory/directoryfile.txt',
            },
          },
        ],
      })
        .then((compilation) => {
          const absFrom = path.resolve(HELPER_DIR, 'directory');

          expect(compilation.contextDependencies).not.toContain(absFrom);
        })
        .then(done)
        .catch(done);
    });

    it('only include files that have changed', (done) => {
      runChange({
        expectedAssetKeys: ['tempfile1.txt'],
        newFileLoc1: path.join(HELPER_DIR, 'watch', 'tempfile1.txt'),
        newFileLoc2: path.join(HELPER_DIR, 'watch', 'tempfile2.txt'),
        patterns: [
          {
            from: 'tempfile1.txt',
          },
          {
            from: 'tempfile2.txt',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('only include files that have changed', (done) => {
      runChange({
        expectedAssetKeys: ['tempfile1.txt'],
        newFileLoc1: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile1.txt'
        ),
        newFileLoc2: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile2.txt'
        ),
        patterns: [
          {
            from: 'directory',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('include all files if copyUnmodified is true', (done) => {
      runChange({
        expectedAssetKeys: ['tempfile1.txt', 'tempfile2.txt', '.gitkeep'],
        newFileLoc1: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile1.txt'
        ),
        newFileLoc2: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile2.txt'
        ),
        options: {
          copyUnmodified: true,
        },
        patterns: [
          {
            from: 'directory',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('copy only changed files', (done) => {
      runChange({
        expectedAssetKeys: ['dest1/tempfile1.txt'],
        newFileLoc1: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile1.txt'
        ),
        newFileLoc2: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile2.txt'
        ),
        patterns: [
          {
            context: 'directory',
            from: '**/*.txt',
            to: 'dest1',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('copy only changed files (multiple patterns)', (done) => {
      runChange({
        expectedAssetKeys: ['dest1/tempfile1.txt', 'dest2/tempfile1.txt'],
        newFileLoc1: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile1.txt'
        ),
        newFileLoc2: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile2.txt'
        ),
        patterns: [
          {
            context: 'directory',
            from: '**/*.txt',
            to: 'dest1',
          },
          {
            context: 'directory',
            from: '**/*.txt',
            to: 'dest2',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('copy only changed files (multiple patterns with difference context)', (done) => {
      runChange({
        expectedAssetKeys: [
          'dest1/tempfile1.txt',
          'dest2/directory/tempfile1.txt',
        ],
        newFileLoc1: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile1.txt'
        ),
        newFileLoc2: path.join(HELPER_DIR, 'watch', 'tempfile2.txt'),
        patterns: [
          {
            context: 'directory',
            from: '**/*.txt',
            to: 'dest1',
          },
          {
            from: '**/*.txt',
            to: 'dest2',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('copy only changed files (multiple patterns with difference context 1)', (done) => {
      runChange({
        expectedAssetKeys: [
          'dest1/directory/tempfile1.txt',
          'dest2/tempfile1.txt',
        ],
        newFileLoc1: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile1.txt'
        ),
        newFileLoc2: path.join(HELPER_DIR, 'watch', 'tempfile2.txt'),
        patterns: [
          {
            from: '**/*.txt',
            to: 'dest1',
          },
          {
            context: 'directory',
            from: '**/*.txt',
            to: 'dest2',
          },
        ],
      })
        .then(done)
        .catch(done);
    });

    it('copy only changed files (multiple patterns with difference context 2)', (done) => {
      runChange({
        expectedAssetKeys: ['dest1/tempfile1.txt'],
        newFileLoc1: path.join(HELPER_DIR, 'watch', 'tempfile1.txt'),
        newFileLoc2: path.join(
          HELPER_DIR,
          'watch',
          'directory',
          'tempfile2.txt'
        ),
        patterns: [
          {
            from: '**/*.txt',
            to: 'dest1',
          },
          {
            context: 'directory',
            from: '**/*.txt',
            to: 'dest2',
          },
        ],
      })
        .then(done)
        .catch(done);
    });
  });
});
