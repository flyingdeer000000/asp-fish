
let quick = require('quick-pomelo');
let P = quick.Promise;
let versionConfig = require('../../../../config/version');
let utils = require('../../../utils/utils');

const Mona = require('../../../dao/mona')
const {Ret} = require("../../../utils/format-util");


let TestHandler = function (app) {
    this.app = app;
    this.mona = new Mona({
        shardId: app.getServerId()
    });
    this.db = this.app.get('sync');
};

module.exports = function (app) {
    return new TestHandler(app);
};

let proto = TestHandler.prototype;
let cort = P.coroutine;


proto.getTime = async function (msg, session, next) {
    try {
        const date = new Date();
        const d_p = (utils.checkENV(this.app, 'development') ? ' d' : ' p');
        const ret = {
            iso: date.toISOString(),
            num: date.getTime(),
            timezone_offset: date.getTimezoneOffset(),
            version: versionConfig['version'] + d_p,
            version_date: versionConfig['date'],
        }
        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, "", ex);
    }
}


proto.getSession = async function (msg, session, next) {
    try {
        const ret = {};
        ret.id = session.id;
        ret.uid = session.uid;

        const fields = [
            'gameId', 'playerId',
            'creditCode', 'demoMode',
            'roundID',
            'gameServerId', 'appServerId',
            'os', 'osVersion', 'browser', 'browserVersion',
            'dc', 'agentId', 'accessToken',
            'betSetting', 'domainSetting',
        ]

        ret.gameId = session.get('gameId');
        ret.playerId = session.get('playerId');

        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            ret[field] = session.get(field);
        }

        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, "", ex);
    }
}


proto.getPlayer = async function (msg, session, next) {
    const ret = {};
    const self = this;
    try {
        const playerId = msg.playerId || msg.uid;
        const schema = this.app.models['FishHunterPlayer'];
        ret.data = await this.mona.get({
            schema: schema,
            id: playerId,
        });
        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, "", ex);
    }
}


proto.getGameToken = async function (msg, session, next) {
    const ret = {};
    try {
        const playerId = msg.playerId || msg.uid;
        const gameId = msg.gameId;
        ret.data = await this.mona.findOne({
            schema: this.app.models['GameTokens'],
            query: {
                gameId: gameId,
                playerId: playerId,
            }
        });
        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, "", ex);
    }
}


proto.getTable = async function (msg, session, next) {
    const ret = {};
    try {
        const tableId = msg.id || msg.tableId;
        ret.data = await this.mona.get({
            schema: this.app.models['Table'],
            id: tableId,
        });
        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, "", ex);
    }
}

proto.clearTable = async function (msg, session, next) {
    try {
        const ret = {};
        const query = msg.query;
        ret.data = await this.mona.remove({
            schema: this.app.models['Table'],
            query: query || {},
        });
        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, "clearTable", ex);
    }
}

proto.getArea = async function (msg, session, next) {
    const ret = {};
    try {
        const areaId = msg.id || msg.areaId;
        ret.data = await this.mona.get({
            schema: this.app.models['FishHunterArea'],
            id: areaId,
        });
        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, "", ex);
    }
}

proto.testSync = function (msg, session, next) {
    try {
        const ret = {};
        ret.funcs = Ret.listFunc(this.db);
        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, "", ex);
    }
}