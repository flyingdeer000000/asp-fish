/**
 * Created by GOGA on 2019/6/18.
 */
let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('wallet', __filename);
const uuid = require('uuid/v1');
let util = require('util');
let utils = require('../utils/utils');
let consts = require('../../share/consts')

module.exports = memdbDao = function (app) {
    this.app = app;
    this.name = 'BulletHistoryDao'
}

let proto = memdbDao.prototype;
let cort = P.coroutine;

proto.findByIdAsync = function (id, readOnly, shardId) {
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelBulletHistory = app.models.FishHunterBulletsHistory;

        if (readOnly) {
            return modelBulletHistory.findByIdReadOnlyAsync(id);
        } else {
            return modelBulletHistory.findByIdAsync(id);
        }
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.findByIdAsync `, err);
            return null;
        })
}

proto.removeByIdAsync = function (id, shardId) {
    logger.debug(`${this.name}.removeByIdAsync data ${id}`);

    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelBulletHistory = app.models.FishHunterBulletsHistory;

        if (!id) {
            return null;
        }

        let rec = yield modelBulletHistory.findByIdAsync(id);
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

proto.createAsync = function (data, shardId) {
    logger.debug(`${this.name}.createAsync data ${data}`);

    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelBulletHistory = app.models.FishHunterBulletsHistory;
        data.finishTime = utils.timeConvert(Date.now(), true);

        let rec = new modelBulletHistory(data);
        let bulletHistory = _.cloneDeep(rec);
        // 字串化，方便 log 看
        if (!!bulletHistory.getInfo && Object.keys(bulletHistory.getInfo).length > 0 && Object.keys(bulletHistory.getInfo).indexOf('treasure') > -1) {
            bulletHistory.getInfo['treasure']['odds'] = JSON.stringify(bulletHistory.getInfo['treasure']['odds']);
        }
        logger.info('[子單][bulletHistoryDao][createAsync] bulletHistory: ', bulletHistory);

        yield rec.saveAsync();
        return rec;
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.createAsync `, err);
            return null;
        })
}