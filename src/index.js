import path from 'path';

import webpack from 'webpack';
import validateOptions from 'schema-utils';
import pLimit from 'p-limit';

import schema from './options.json';
import processPattern from './processPattern';
import postProcessPattern from './postProcessPattern';
import isTemplateLike from './utils/isTemplateLike';
import { stat } from './utils/promisify';

// webpack 5 exposes the sources property to ensure the right version of webpack-sources is used
const { RawSource } =
  // eslint-disable-next-line global-require
  webpack.sources || require('webpack-sources');

class CopyPlugin {
  constructor(options = {}) {
    validateOptions(schema, options, {
      name: 'Copy Plugin',
      baseDataPath: 'options',
    });

    this.patterns = options.patterns;
    this.options = options.options || {};
  }

  // eslint-disable-next-line class-methods-use-this
  async runPattern(globalRef, inputPattern) {
    const { logger } = globalRef;
    const pattern =
      typeof inputPattern === 'string'
        ? { from: inputPattern }
        : { ...inputPattern };

    pattern.fromOrigin = pattern.from;
    pattern.from = path.normalize(pattern.from);
    pattern.to = path.normalize(
      typeof pattern.to !== 'undefined' ? pattern.to : ''
    );

    pattern.context = path.normalize(
      typeof pattern.context !== 'undefined'
        ? !path.isAbsolute(pattern.context)
          ? path.join(globalRef.context, pattern.context)
          : pattern.context
        : globalRef.context
    );

    logger.debug(`processing from: '${pattern.from}' to: '${pattern.to}'`);

    const isToDirectory =
      path.extname(pattern.to) === '' || pattern.to.slice(-1) === path.sep;

    switch (true) {
      // if toType already exists
      case !!pattern.toType:
        break;
      case isTemplateLike(pattern.to):
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
      `getting stats for '${pattern.absoluteFrom}' to determinate 'fromType'`
    );

    let stats;

    try {
      stats = await stat(globalRef.inputFileSystem, pattern.absoluteFrom);
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

    const files = await processPattern(globalRef, pattern);

    if (!files) {
      return Promise.resolve();
    }

    return Promise.all(
      files
        .filter(Boolean)
        .map((file) => postProcessPattern(globalRef, pattern, file))
    );
  }

  apply(compiler) {
    const pluginName = this.constructor.name;
    const limit = pLimit(this.options.concurrency || 100);

    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      const logger = compilation.getLogger('copy-webpack-plugin');

      compilation.hooks.additionalAssets.tapAsync(
        'copy-webpack-plugin',
        async (callback) => {
          logger.debug('start to adding additional assets');

          const globalRef = {
            context: compiler.options.context,
            logger,
            compilation,
            inputFileSystem: compiler.inputFileSystem,
            output: compiler.options.output.path,
          };

          let assets;

          try {
            assets = await Promise.all(
              this.patterns.map((item) =>
                limit(async () => this.runPattern(globalRef, item))
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
                absoluteFrom,
                targetPath,
                webpackTo,
                data,
                force,
              } = asset;

              const source = new RawSource(data);

              // For old version webpack 4
              /* istanbul ignore if */
              if (typeof compilation.emitAsset !== 'function') {
                // eslint-disable-next-line no-param-reassign
                compilation.assets[targetPath] = source;

                return;
              }

              const existingAsset = compilation.getAsset(targetPath);

              if (existingAsset) {
                if (force) {
                  logger.log(
                    `force updating '${webpackTo}' to compilation assets from '${absoluteFrom}'`
                  );

                  const info = { copied: true };

                  if (asset.immutable) {
                    info.immutable = true;
                  }

                  compilation.updateAsset(targetPath, source, info);

                  return;
                }

                logger.log(
                  `skipping '${webpackTo}', because it already exists`
                );

                return;
              }

              logger.log(
                `writing '${webpackTo}' to compilation assets from '${absoluteFrom}'`
              );

              const info = { copied: true };

              if (asset.immutable) {
                info.immutable = true;
              }

              compilation.emitAsset(targetPath, source, info);
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
