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
    this.name = 'AreaPlayerHistoryDao'
}

let proto = memdbDao.prototype;
let cort = P.coroutine;

proto.findByIdAsync = function (id, readOnly, shardId) {
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelAreaPlayerHistory = app.models.FishHunterAreaPlayersHistory;

        if (readOnly) {
            return modelAreaPlayerHistory.findByIdReadOnlyAsync(id);
        } else {
            return modelAreaPlayerHistory.findByIdAsync(id);
        }
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.findByIdAsync `, err);
            return null;
        })
}

proto.createAsync = function (data, shardId) {
    logger.debug(`${this.name}.createAsync `, util.inspect(data, false, 10));

    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelAreaPlayerHistory = app.models.FishHunterAreaPlayersHistory;
        data._id = data._id || uuid();
        data.createTime = utils.timeConvert(Date.now(), true);

        let rec = new modelAreaPlayerHistory(data)
        // 字串化，方便 log 看
        if (!!rec.gunInfo && rec.gunInfo.length > 0) {
            for (let i = 0; i < rec.gunInfo.length; i++) {
                if (!!rec.gunInfo[i].getBullet && rec.gunInfo[i].getBullet.length > 0) {
                    rec.gunInfo[i].getBullet = JSON.stringify(rec.gunInfo[i].getBullet);
                }
                delete rec.gunInfo[i].sourceWid;
            }
        }
        logger.info('[母單][areaPlayerHistoryDao][createAsync] areaPlayersHistory: ', rec);
        return rec.saveAsync().then(() => {
            return rec;
        });
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.createAsync `, err);
            return null;
        })
}

proto.removeByIdAsync = function (id, shardId) {
    logger.debug(`${this.name}.removeByIdAsync data ${id}`);

    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelAreaPlayerHistory = app.models.FishHunterAreaPlayersHistory;

        if (!id) {
            return null;
        }

        let rec = yield modelAreaPlayerHistory.findByIdAsync(id);
        if (!!rec) {
            yield rec.removeAsync();
        }

        return rec;
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.removeByIdAsync `, err);
            return null;
        })
}