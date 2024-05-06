/**
 * Created by GOGA on 2019/6/18.
 */
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('dao', __filename);
const uuid = require('uuid/v1');
let util = require('util');
let utils = require('../utils/utils');
let consts = require('../../share/consts')

module.exports = memdbDao = function (app) {
    this.app = app;
    this.name = 'PlayerDao'
}

let proto = memdbDao.prototype;
let cort = P.coroutine;

proto.findByIdAsync = function (playerId, readOnly, shardId) {
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelPlayer = app.models.FishHunterPlayer;

        if (readOnly) {
            return modelPlayer.findByIdReadOnlyAsync(playerId);
        } else {
            return modelPlayer.findByIdAsync(playerId);
        }
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.findByIdAsync `, err);
            return null;
        })
}