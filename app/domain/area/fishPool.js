let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('area', __filename);
const uuid = require('uuid/v1');
const _ = require('lodash');
let EventEmitter = require('events').EventEmitter;
let util = require('util');
let utils = require('../../utils/utils');
let consts = require('../../../share/consts');
let sprintf = require('sprintf-js').sprintf;

module.exports = FishPool = function (app, areaId) {
    EventEmitter.call(this);

    this.app = app;
    this.areaId = areaId;

    this.fishObjs = {};
}
util.inherits(FishPool, EventEmitter);

let proto = FishPool.prototype;
let cort = P.coroutine;

proto.addFish = function (id, idx, type, data, gameId) {
    try {
        logger.debug('[fishPool][addFish] Id = %s, idx = %s, type = %s, count = %s', id, idx, type, this.count());

        if (!!this.fishObjs[id]) {
            throw (sprintf('id duplicate, gameId = %s, Id = %s, idx = %s, type = %s', gameId, id, idx, type));
        }

        this.fishObjs[id] = {type, idx, data};
        return true;
    } catch (err) {
        logger.error('[fishPool][addFish][catch] err: %s', err);
        return false;
    }
}

proto.delFish = function (id) {
    try {
        logger.debug('[fishPool][delFish] Id = %s, count = %s', id, this.count());

        if (!this.fishObjs[id]) {
            throw (sprintf('id not exist, Id = %s', id));
        }

        delete this.fishObjs[id];
        return true;
    } catch (err) {
        logger.error('[fishPool][delFish][catch] err: %s', err);
        return false;
    }
}

proto.count = function () {
    try {
        return Object.keys(this.fishObjs).length;
    } catch (err) {
        logger.error('[fishPool][count][catch] err: %s', err);
        return 0;
    }
}

proto.cleanFish = function () {
    try {
        let ids = [];
        Object.keys(this.fishObjs).forEach(v => {
            if (this.fishObjs[v].idx != 0) {
                ids.push(v);
            }
        });

        ids.forEach(v => {
            delete this.fishObjs[v];
        });
    } catch (err) {
        logger.error('[fishPool][cleanFish][catch] err: %s', err);
    }
}

proto.getFishData = function (id) {
    try {
        let fish = this.fishObjs[id];
        if (!!fish) {
            return fish.data;
        }
        return null;
    } catch (err) {
        logger.error('[fishPool][getFishData][catch] err: %s', err);
        return null;
    }
}

proto.getAllFishes = function () {
    try {
        let res = [];
        Object.keys(this.fishObjs).forEach(v => {
            res.push(this.fishObjs[v].data);
        });
        return res;
    } catch (err) {
        logger.error('[fishPool][getAllFishes][catch] err: %s', err);
        return null;
    }
}

proto.updateFish = function (id, opts) {
    try {
        let fish = this.fishObjs[id];

        if (!!fish) {
            let data = fish.data;
            for (let i in opts) {
                data[i] = opts[i];
            }
            return data;
        }
        return null;
    } catch (err) {
        logger.error('[fishPool][updateFish][catch] err: %s', err);
        return null;
    }
}

proto.searchFish = function (opts) {
    try {
        let res = [];

        let match = (data, filters) => {
            let isSame = true;
            for (let i in filters) {
                if (filters[i] != data[i]) {
                    isSame = false;
                    break;
                }
            }
            return isSame;
        }

        for (let i in this.fishObjs) {
            let fishData = this.fishObjs[i].data;
            if (match(fishData, opts)) {
                res.push(fishData);
            }
        }

        return res;
    } catch (err) {
        logger.error('[fishPool][searchFish][catch] err: %s', err);
        return [];
    }
}
