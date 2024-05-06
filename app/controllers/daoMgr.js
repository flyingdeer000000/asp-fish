/**
 * Created by GOGA on 2019/6/18.
 */
let quick = require('quick-pomelo');
let P = quick.Promise;
let GameTokenDao = require('../dao/gameTokenDao');
let PlayerDao = require('../dao/playerDao');
let AreaPlayerDao = require('../dao/areaPlayerDao');
let AreaPlayerHistoryDao = require('../dao/areaPlayerHistoryDao');
let FrozenBillDao = require('../dao/frozenBillDao');
let BulletHistoryDao = require('../dao/bulletHistoryDao');

let Controller = function (app) {
    this.app = app;
    this.daos = {};
};

module.exports = function (app) {
    return new Controller(app);
};


let proto = Controller.prototype;
let cort = P.coroutine;

proto._getDao = function (name, ctor) {
    if (!!this.daos[name]) {
        return this.daos[name];
    }

    let dao = new ctor(this.app);
    this.daos[name] = dao;

    return dao;
}

proto.getGameTokenDao = function () {
    return this._getDao('GameTokenDao', GameTokenDao)
}

proto.getPlayerDao = function () {
    return this._getDao('PlayerDao', PlayerDao)
}

proto.getAreaPlayerDao = function () {
    return this._getDao('AreaPlayerDao', AreaPlayerDao)
}

proto.getAreaPlayerHistoryDao = function () {
    return this._getDao('AreaPlayerHistoryDao', AreaPlayerHistoryDao)
}

proto.getFrozenBillDao = function () {
    return this._getDao('FrozenBillDao', FrozenBillDao)
}

proto.getBulletHistoryDao = function () {
    return this._getDao('BulletHistoryDao', BulletHistoryDao)
}