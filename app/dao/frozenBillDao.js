/**
 * Created by GOGA on 2019/6/18.
 */
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('wallet', __filename);
const uuid = require('uuid/v1');
let util = require('util');
let utils = require('../utils/utils');
let consts = require('../../share/consts')

module.exports = memdbDao = function (app) {
    this.app = app;
    this.name = 'FrozenBillDao'
}

let proto = memdbDao.prototype;
let cort = P.coroutine;

proto.findByIdAsync = function (id, readOnly, shardId) {
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelFrozenBill = app.models.FrozenBill;

        if (readOnly) {
            return modelFrozenBill.findByIdReadOnlyAsync(id);
        } else {
            return modelFrozenBill.findByIdAsync(id);
        }
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.findByIdAsync `, err);
            return null;
        })
}

proto.createAsync = function (data, shardId) {
    logger.warn(`${this.name}.createAsync data ${util.inspect(data, false, 10)}`);

    // let app = this.app;

    // return app.memdb.goose.transactionAsync(cort(function* () {
    //   let modelFrozenBill = app.models.FrozenBill;
    //   data._id = data._id || uuid();
    //
    //   let rec = new modelFrozenBill(data)
    //   return rec.saveAsync().then(() => {
    //     return rec;
    //   });
    // }),shardId || app.getServerId())
    // .catch(err => {
    //   logger.error(`${this.name}.createAsync `,err);
    //   return null;
    // })
}
