import { path } from '../../core/path.js';
import { Debug } from '../../core/debug.js';

import { http, Http } from '../../platform/net/http.js';

import { GlbModelParser } from '../parsers/glb-model.js';
import { JsonModelParser } from '../parsers/json-model.js';

import { getDefaultMaterial } from '../../scene/materials/default-material.js';

/** @typedef {import('../../framework/app-base.js').AppBase} AppBase */
/** @typedef {import('./handler.js').ResourceHandler} ResourceHandler */

/**
 * Callback used by {@link ModelHandler#addParser} to decide on which parser to use.
 *
 * @callback AddParserCallback
 * @param {string} url - The resource url.
 * @param {object} data - The raw model data.
 * @returns {boolean} Return true if this parser should be used to parse the data into a
 * {@link Model}.
 */

/**
 * Resource handler used for loading {@link Model} resources.
 *
 * @implements {ResourceHandler}
 */
class ModelHandler {
    /**
     * Type of the resource the handler handles.
     *
     * @type {string}
     */
    handlerType = "model";

    /**
     * Create a new ModelHandler instance.
     *
     * @param {AppBase} app - The running {@link AppBase}.
     * @hideconstructor
     */
    constructor(app) {
        this._device = app.graphicsDevice;
        this._parsers = [];
        this._defaultMaterial = getDefaultMaterial(this._device);
        this.maxRetries = 0;

        this.addParser(new JsonModelParser(this._device, this._defaultMaterial), function (url, data) {
            return (path.getExtension(url) === '.json');
        });
        this.addParser(new GlbModelParser(this._device, this._defaultMaterial), function (url, data) {
            return (path.getExtension(url) === '.glb');
        });
    }

    load(url, callback) {
        if (typeof url === 'string') {
            url = {
                load: url,
                original: url
            };
        }

        // we need to specify JSON for blob URLs
        const options = {
            retry: this.maxRetries > 0,
            maxRetries: this.maxRetries
        };

        if (url.load.startsWith('blob:') || url.load.startsWith('data:')) {
            if (path.getExtension(url.original).toLowerCase() === '.glb') {
                options.responseType = Http.ResponseType.ARRAY_BUFFER;
            } else {
                options.responseType = Http.ResponseType.JSON;
            }
        }

        http.get(url.load, options, function (err, response) {
            if (!callback)
                return;

            if (!err) {
                callback(null, response);
            } else {
                callback(`Error loading model: ${url.original} [${err}]`);
            }
        });
    }

    open(url, data) {
        for (let i = 0; i < this._parsers.length; i++) {
            const p = this._parsers[i];

            if (p.decider(url, data)) {
                return p.parser.parse(data);
            }
        }
        Debug.warn('pc.ModelHandler#open: No model parser found for: ' + url);
        return null;
    }

    patch(asset, assets) {
        if (!asset.resource)
            return;

        const data = asset.data;

        const self = this;
        asset.resource.meshInstances.forEach(function (meshInstance, i) {
            if (data.mapping) {
                const handleMaterial = function (asset) {
                    if (asset.resource) {
                        meshInstance.material = asset.resource;
                    } else {
                        asset.once('load', handleMaterial);
                        assets.load(asset);
                    }

                    asset.once('remove', function (asset) {
                        if (meshInstance.material === asset.resource) {
                            meshInstance.material = self._defaultMaterial;
                        }
                    });
                };

                if (!data.mapping[i]) {
                    meshInstance.material = self._defaultMaterial;
                    return;
                }

                const id = data.mapping[i].material;
                const url = data.mapping[i].path;
                let material;

                if (id !== undefined) { // id mapping
                    if (!id) {
                        meshInstance.material = self._defaultMaterial;
                    } else {
                        material = assets.get(id);
                        if (material) {
                            handleMaterial(material);
                        } else {
                            assets.once('add:' + id, handleMaterial);
                        }
                    }
                } else if (url) {
                    // url mapping
                    const path = asset.getAbsoluteUrl(data.mapping[i].path);
                    material = assets.getByUrl(path);

                    if (material) {
                        handleMaterial(material);
                    } else {
                        assets.once('add:url:' + path, handleMaterial);
                    }
                }
            }
        });
    }

    /**
     * Add a parser that converts raw data into a {@link Model}. Default parser is for JSON models.
     *
     * @param {object} parser - See JsonModelParser for example.
     * @param {AddParserCallback} decider - Function that decides on which parser to use. Function
     * should take (url, data) arguments and return true if this parser should be used to parse the
     * data into a {@link Model}. The first parser to return true is used.
     */
    addParser(parser, decider) {
        this._parsers.push({
            parser: parser,
            decider: decider
        });
    }
}

export { ModelHandler };
