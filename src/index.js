import path from 'path';
import os from 'os';
import crypto from 'crypto';

import webpack from 'webpack';
import { validate } from 'schema-utils';
import pLimit from 'p-limit';
import globby from 'globby';
import findCacheDir from 'find-cache-dir';
import serialize from 'serialize-javascript';
import cacache from 'cacache';
import loaderUtils from 'loader-utils';
import normalizePath from 'normalize-path';
import globParent from 'glob-parent';
import fastGlob from 'fast-glob';

import { version } from '../package.json';

import schema from './options.json';
import { readFile, stat } from './utils/promisify';

// webpack 5 exposes the sources property to ensure the right version of webpack-sources is used
const { RawSource } =
  // eslint-disable-next-line global-require
  webpack.sources || require('webpack-sources');

const template = /(\[ext\])|(\[name\])|(\[path\])|(\[folder\])|(\[emoji(?::(\d+))?\])|(\[(?:([^:\]]+):)?(?:hash|contenthash)(?::([a-z]+\d*))?(?::(\d+))?\])|(\[\d+\])/;

class CopyPlugin {
  constructor(options = {}) {
    validate(schema, options, {
      name: 'Copy Plugin',
      baseDataPath: 'options',
    });

    this.patterns = options.patterns;
    this.options = options.options || {};
  }

  static async createSnapshot(compilation, startTime, dependency) {
    if (!compilation.fileSystemInfo) {
      return;
    }

    // eslint-disable-next-line consistent-return
    return new Promise((resolve, reject) => {
      compilation.fileSystemInfo.createSnapshot(
        startTime,
        [dependency],
        // eslint-disable-next-line no-undefined
        undefined,
        // eslint-disable-next-line no-undefined
        undefined,
        null,
        (error, snapshot) => {
          if (error) {
            reject(error);

            return;
          }

          resolve(snapshot);
        }
      );
    });
  }

  static async checkSnapshotValid(compilation, snapshot) {
    if (!compilation.fileSystemInfo) {
      return;
    }

    // eslint-disable-next-line consistent-return
    return new Promise((resolve, reject) => {
      compilation.fileSystemInfo.checkSnapshotValid(
        snapshot,
        (error, isValid) => {
          if (error) {
            reject(error);

            return;
          }

          resolve(isValid);
        }
      );
    });
  }

  // eslint-disable-next-line class-methods-use-this
  static async runPattern(compiler, compilation, logger, cache, inputPattern) {
    const pattern =
      typeof inputPattern === 'string'
        ? { from: inputPattern }
        : { ...inputPattern };

    pattern.fromOrigin = pattern.from;
    pattern.from = path.normalize(pattern.from);
    pattern.to = path.normalize(
      typeof pattern.to !== 'undefined' ? pattern.to : ''
    );
    pattern.compilerContext = compiler.context;
    pattern.context = path.normalize(
      typeof pattern.context !== 'undefined'
        ? !path.isAbsolute(pattern.context)
          ? path.join(pattern.compilerContext, pattern.context)
          : pattern.context
        : pattern.compilerContext
    );

    logger.debug(`processing from "${pattern.from}" to "${pattern.to}"`);

    const isToDirectory =
      path.extname(pattern.to) === '' || pattern.to.slice(-1) === path.sep;

    switch (true) {
      // if toType already exists
      case !!pattern.toType:
        break;
      case template.test(pattern.to):
        pattern.toType = 'template';
        break;
      case isToDirectory:
        pattern.toType = 'dir';
        break;
      default:
        pattern.toType = 'file';
    }

    if (path.isAbsolute(pattern.from)) {
      pattern.absoluteFrom = pattern.from;
    } else {
      pattern.absoluteFrom = path.resolve(pattern.context, pattern.from);
    }

    logger.debug(
      `getting stats for "${pattern.absoluteFrom}" to determinate "fromType"`
    );

    const { inputFileSystem } = compiler;

    let stats;

    try {
      stats = await stat(inputFileSystem, pattern.absoluteFrom);
    } catch (error) {
      // Nothing
    }

    if (stats) {
      if (stats.isDirectory()) {
        pattern.fromType = 'dir';
      } else if (stats.isFile()) {
        pattern.fromType = 'file';
      }
    }

    // eslint-disable-next-line no-param-reassign
    pattern.globOptions = {
      ...{ followSymbolicLinks: true },
      ...(pattern.globOptions || {}),
      ...{ cwd: pattern.context, objectMode: true },
    };

    // TODO remove after drop webpack@4
    if (
      inputFileSystem.lstat &&
      inputFileSystem.stat &&
      inputFileSystem.lstatSync &&
      inputFileSystem.statSync &&
      inputFileSystem.readdir &&
      inputFileSystem.readdirSync
    ) {
      pattern.globOptions.fs = inputFileSystem;
    }

    switch (pattern.fromType) {
      case 'dir':
        logger.debug(`determined "${pattern.absoluteFrom}" is a directory`);

        compilation.contextDependencies.add(pattern.absoluteFrom);

        logger.debug(`add "${pattern.absoluteFrom}" as a context dependency`);

        /* eslint-disable no-param-reassign */
        pattern.context = pattern.absoluteFrom;
        pattern.glob = path.posix.join(
          fastGlob.escapePath(
            normalizePath(path.resolve(pattern.absoluteFrom))
          ),
          '**/*'
        );
        pattern.absoluteFrom = path.join(pattern.absoluteFrom, '**/*');

        if (typeof pattern.globOptions.dot === 'undefined') {
          pattern.globOptions.dot = true;
        }
        /* eslint-enable no-param-reassign */
        break;
      case 'file':
        logger.debug(`determined "${pattern.absoluteFrom}" is a file`);

        compilation.fileDependencies.add(pattern.absoluteFrom);

        logger.debug(`add "${pattern.absoluteFrom}" as a file dependency`);

        /* eslint-disable no-param-reassign */
        pattern.context = path.dirname(pattern.absoluteFrom);
        pattern.glob = fastGlob.escapePath(
          normalizePath(path.resolve(pattern.absoluteFrom))
        );

        if (typeof pattern.globOptions.dot === 'undefined') {
          pattern.globOptions.dot = true;
        }
        /* eslint-enable no-param-reassign */
        break;
      default: {
        logger.debug(`determined "${pattern.absoluteFrom}" is a glob`);

        const contextDependencies = path.normalize(
          globParent(pattern.absoluteFrom)
        );

        compilation.contextDependencies.add(contextDependencies);

        logger.debug(`add "${contextDependencies}" as a context dependency`);

        /* eslint-disable no-param-reassign */
        pattern.fromType = 'glob';
        pattern.glob = path.isAbsolute(pattern.fromOrigin)
          ? pattern.fromOrigin
          : path.posix.join(
              fastGlob.escapePath(normalizePath(path.resolve(pattern.context))),
              pattern.fromOrigin
            );
        /* eslint-enable no-param-reassign */
      }
    }

    logger.log(
      `begin globbing "${pattern.glob}" with a context of "${pattern.context}"`
    );

    let paths;

    try {
      paths = await globby(pattern.glob, pattern.globOptions);
    } catch (error) {
      compilation.errors.push(error);

      return;
    }

    if (paths.length === 0) {
      if (pattern.noErrorOnMissing) {
        return;
      }

      const missingError = new Error(
        `unable to locate "${pattern.from}" at "${pattern.absoluteFrom}"`
      );

      logger.error(missingError.message);

      compilation.errors.push(missingError);

      return;
    }

    const filteredPaths = (
      await Promise.all(
        paths.map(async (item) => {
          // Exclude directories
          if (!item.dirent.isFile()) {
            return false;
          }

          if (pattern.filter) {
            let isFiltered;

            try {
              isFiltered = await pattern.filter(item.path);
            } catch (error) {
              compilation.errors.push(error);

              return false;
            }

            return isFiltered ? item : false;
          }

          return item;
        })
      )
    ).filter((item) => item);

    if (filteredPaths.length === 0) {
      return;
    }

    const files = filteredPaths.map((item) => {
      const from = item.path;

      logger.debug(`found "${from}"`);

      // `globby`/`fast-glob` return the relative path when the path contains special characters on windows
      const absoluteFilename = path.resolve(pattern.context, from);
      const relativeFrom = pattern.flatten
        ? path.basename(absoluteFilename)
        : path.relative(pattern.context, absoluteFilename);
      let filename =
        pattern.toType === 'dir'
          ? path.join(pattern.to, relativeFrom)
          : pattern.to;

      if (path.isAbsolute(filename)) {
        filename = path.relative(compiler.options.output.path, filename);
      }

      logger.log(`determined that "${from}" should write to "${filename}"`);

      const sourceFilename = normalizePath(
        path.relative(pattern.compilerContext, absoluteFilename)
      );

      return { absoluteFilename, sourceFilename, filename };
    });

    // eslint-disable-next-line consistent-return
    return Promise.all(
      files.map(async (file) => {
        // If this came from a glob, add it to the file watchlist
        if (pattern.fromType === 'glob') {
          logger.debug(`add ${file.absoluteFilename} as fileDependencies`);

          compilation.fileDependencies.add(file.absoluteFilename);
        }

        let source;

        if (cache) {
          let cacheEntry;

          try {
            cacheEntry = await cache.getPromise(file.sourceFilename, null);
          } catch (error) {
            compilation.errors.push(error);

            return;
          }

          if (cacheEntry) {
            let isValidSnapshot;

            try {
              isValidSnapshot = await CopyPlugin.checkSnapshotValid(
                compilation,
                cacheEntry.snapshot
              );
            } catch (error) {
              compilation.errors.push(error);

              return;
            }

            if (isValidSnapshot) {
              ({ source } = cacheEntry);
            }
          }
        }

        if (!source) {
          let startTime;

          if (cache) {
            startTime = Date.now();
          }

          logger.debug(`reading "${file.absoluteFilename}" to write to assets`);

          let data;

          try {
            data = await readFile(inputFileSystem, file.absoluteFilename);
          } catch (error) {
            compilation.errors.push(error);

            return;
          }

          if (pattern.transform) {
            logger.log(`transforming content for "${file.absoluteFilename}"`);

            if (pattern.cacheTransform) {
              const cacheDirectory = pattern.cacheTransform.directory
                ? pattern.cacheTransform.directory
                : typeof pattern.cacheTransform === 'string'
                ? pattern.cacheTransform
                : findCacheDir({ name: 'copy-webpack-plugin' }) || os.tmpdir();
              let defaultCacheKeys = {
                version,
                transform: pattern.transform,
                contentHash: crypto
                  .createHash('md4')
                  .update(data)
                  .digest('hex'),
              };

              defaultCacheKeys =
                typeof pattern.cacheTransform.keys === 'function'
                  ? await pattern.cacheTransform.keys(
                      defaultCacheKeys,
                      file.absoluteFilename
                    )
                  : {
                      ...defaultCacheKeys,
                      ...pattern.cacheTransform.keys,
                    };

              const cacheKeys = serialize(defaultCacheKeys);

              try {
                const result = await cacache.get(cacheDirectory, cacheKeys);

                logger.debug(
                  `getting cached transformation for "${file.absoluteFilename}"`
                );

                ({ data } = result);
              } catch (_ignoreError) {
                data = await pattern.transform(data, file.absoluteFilename);

                logger.debug(
                  `caching transformation for "${file.absoluteFilename}"`
                );

                await cacache.put(cacheDirectory, cacheKeys, data);
              }
            } else {
              data = await pattern.transform(data, file.absoluteFilename);
            }
          }

          source = new RawSource(data);

          if (cache) {
            let snapshot;

            try {
              snapshot = await CopyPlugin.createSnapshot(
                compilation,
                startTime,
                file.sourceFilename
              );
            } catch (error) {
              compilation.errors.push(error);

              return;
            }

            if (snapshot) {
              try {
                await cache.storePromise(file.sourceFilename, null, {
                  source,
                  snapshot,
                });
              } catch (error) {
                compilation.errors.push(error);

                return;
              }
            }
          }
        }

        if (pattern.toType === 'template') {
          logger.log(
            `interpolating template "${file.filename}" for "${file.sourceFilename}"`
          );

          // If it doesn't have an extension, remove it from the pattern
          // ie. [name].[ext] or [name][ext] both become [name]
          if (!path.extname(file.absoluteFilename)) {
            // eslint-disable-next-line no-param-reassign
            file.filename = file.filename.replace(/\.?\[ext]/g, '');
          }

          // eslint-disable-next-line no-param-reassign
          file.immutable = /\[(?:([^:\]]+):)?(?:hash|contenthash)(?::([a-z]+\d*))?(?::(\d+))?\]/gi.test(
            file.filename
          );

          // eslint-disable-next-line no-param-reassign
          file.filename = loaderUtils.interpolateName(
            { resourcePath: file.absoluteFilename },
            file.filename,
            {
              content: source.source(),
              context: pattern.context,
            }
          );

          // Bug in `loader-utils`, package convert `\\` to `/`, need fix in loader-utils
          // eslint-disable-next-line no-param-reassign
          file.filename = path.normalize(file.filename);
        }

        if (pattern.transformPath) {
          logger.log(
            `transforming path "${file.filename}" for "${file.absoluteFilename}"`
          );

          // eslint-disable-next-line no-param-reassign
          file.immutable = false;
          // eslint-disable-next-line no-param-reassign
          file.filename = await pattern.transformPath(
            file.filename,
            file.absoluteFilename
          );
        }

        // eslint-disable-next-line no-param-reassign
        file.source = source;
        // eslint-disable-next-line no-param-reassign
        file.filename = normalizePath(file.filename);
        // eslint-disable-next-line no-param-reassign
        file.force = pattern.force;

        // eslint-disable-next-line consistent-return
        return file;
      })
    );
  }

  apply(compiler) {
    const pluginName = this.constructor.name;
    const limit = pLimit(this.options.concurrency || 100);

    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      const logger = compilation.getLogger('copy-webpack-plugin');
      const cache = compilation.getCache
        ? compilation.getCache('CopyWebpackPlugin')
        : // eslint-disable-next-line no-undefined
          undefined;

      compilation.hooks.additionalAssets.tapAsync(
        'copy-webpack-plugin',
        async (callback) => {
          logger.debug('start to adding additional assets');

          let assets;

          try {
            assets = await Promise.all(
              this.patterns.map((item) =>
                limit(async () =>
                  CopyPlugin.runPattern(
                    compiler,
                    compilation,
                    logger,
                    cache,
                    item
                  )
                )
              )
            );
          } catch (error) {
            compilation.errors.push(error);

            callback();

            return;
          }

          // Avoid writing assets inside `p-limit`, because it creates concurrency.
          // It could potentially lead to an error - "Multiple assets emit different content to the same filename"
          assets
            .reduce((acc, val) => acc.concat(val), [])
            .filter(Boolean)
            .forEach((asset) => {
              const {
                absoluteFilename,
                sourceFilename,
                filename,
                source,
                force,
              } = asset;

              // For old version webpack 4
              /* istanbul ignore if */
              if (typeof compilation.emitAsset !== 'function') {
                // eslint-disable-next-line no-param-reassign
                compilation.assets[filename] = source;

                return;
              }

              const existingAsset = compilation.getAsset(filename);

              if (existingAsset) {
                if (force) {
                  logger.log(
                    `force updating "${filename}" to compilation assets from "${absoluteFilename}"`
                  );

                  const info = { copied: true, sourceFilename };

                  if (asset.immutable) {
                    info.immutable = true;
                  }

                  compilation.updateAsset(filename, source, info);

                  return;
                }

                logger.log(`skipping "${filename}", because it already exists`);

                return;
              }

              logger.log(
                `writing "${filename}" to compilation assets from "${absoluteFilename}"`
              );

              const info = { copied: true, sourceFilename };

              if (asset.immutable) {
                info.immutable = true;
              }

              compilation.emitAsset(filename, source, info);
            });

          logger.debug('end to adding additional assets');

          callback();
        }
      );

      if (compilation.hooks.statsPrinter) {
        compilation.hooks.statsPrinter.tap(pluginName, (stats) => {
          stats.hooks.print
            .for('asset.info.copied')
            .tap('copy-webpack-plugin', (copied, { green, formatFlag }) =>
              // eslint-disable-next-line no-undefined
              copied ? green(formatFlag('copied')) : undefined
            );
        });
      }
    });
  }
}

export default CopyPlugin;
