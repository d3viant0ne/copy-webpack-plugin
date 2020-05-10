import path from 'path';

import { runEmit } from './helpers/run';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('ignore option', () => {
  it('should ignore files when "from" is a file', (done) => {
    runEmit({
      expectedWarnings: [
        new Error(
          `unable to locate 'file.txt' at '${FIXTURES_DIR}${path.sep}file.txt'`
        ),
      ],
      patterns: [
        {
          from: 'file.txt',
          globOptions: {
            ignore: ['**/file.*'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should files when "from" is a directory', (done) => {
    runEmit({
      expectedAssetKeys: [
        '.dottedfile',
        'directoryfile.txt',
        'nested/deep-nested/deepnested.txt',
      ],
      patterns: [
        {
          from: 'directory',
          globOptions: {
            ignore: ['**/nestedfile.*'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should files in nested directory when "from" is a directory', (done) => {
    runEmit({
      expectedAssetKeys: ['.dottedfile', 'directoryfile.txt'],
      patterns: [
        {
          from: 'directory',
          globOptions: {
            ignore: ['**/nested/**'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should files when from is a glob', (done) => {
    runEmit({
      expectedAssetKeys: [
        'directory/directoryfile.txt',
        'directory/nested/deep-nested/deepnested.txt',
      ],
      patterns: [
        {
          from: 'directory/**/*',
          globOptions: {
            ignore: ['**/nestedfile.*'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should files in nested directory when from is a glob', (done) => {
    runEmit({
      expectedAssetKeys: ['directory/directoryfile.txt'],
      patterns: [
        {
          from: 'directory/**/*',
          globOptions: {
            ignore: ['**/nested/**'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should ignore files with a certain extension', (done) => {
    runEmit({
      expectedAssetKeys: ['.dottedfile'],
      patterns: [
        {
          from: 'directory',
          globOptions: {
            ignore: ['**/*.txt'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should ignore files with multiple ignore patterns', (done) => {
    runEmit({
      expectedAssetKeys: ['directory/nested/nestedfile.txt'],
      patterns: [
        {
          from: 'directory/**/*',
          globOptions: {
            ignore: ['**/directoryfile.*', '**/deep-nested/**'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should ignore files except those with dots', (done) => {
    runEmit({
      expectedAssetKeys: ['.dottedfile'],
      patterns: [
        {
          from: 'directory',
          globOptions: {
            ignore: ['!(**/.*)'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should ignore files that start with a dot', (done) => {
    runEmit({
      expectedAssetKeys: [
        'directoryfile.txt',
        'nested/deep-nested/deepnested.txt',
        'nested/nestedfile.txt',
      ],
      patterns: [
        {
          from: 'directory',
          globOptions: {
            ignore: ['**/.*'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should ignores all files even if they start with a dot', (done) => {
    runEmit({
      expectedWarnings: [
        new Error(
          `unable to locate 'directory' at '${FIXTURES_DIR}${path.sep}directory${path.sep}**${path.sep}*'`
        ),
      ],
      patterns: [
        {
          from: 'directory',
          globOptions: {
            ignore: ['**/*'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });

  it('should ignore files when "from" is a file (global ignore)', (done) => {
    runEmit({
      expectedWarnings: [
        new Error(
          `unable to locate 'file.txt' at '${FIXTURES_DIR}${path.sep}file.txt'`
        ),
      ],
      patterns: [
        {
          ignore: ['file.*'],
          from: 'file.txt',
          globOptions: {
            ignore: ['**/file.*'],
          },
        },
      ],
    })
      .then(done)
      .catch(done);
  });
});
