'use strict';

let path = require('path');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = require('quick-pomelo').logger.getLogger('area', __filename);

let TableSearcher = function (app, opts) {
    opts = opts || {};
    this._app = app;
    this.tableIds = {}; // new Map();
    this.queues = {}; //
};

let proto = TableSearcher.prototype;

proto.name = 'tableSearcher';

proto.start = function (cb) {
    cb();
};

proto.stop = function (force, cb) {
    cb();
};

// proto._ensureServer = function () {
//   // if(this._app.getServerType() !== 'area') {
//   //     throw new Error('must be table server to enable TableSearcher: current=' + this._app.getServerType());
//   // }
// };

proto.setTableaAvail = function (tableId, level, gameId, currency, playerCount, betSettingUsedCid) {
    try {
        logger.debug('tableSearcher.setTableAvail: tableId=%s', tableId);
        // this._ensureServer();

        if (!gameId) {
            throw new Error('tableSearcher wrong params 1 ' + gameId);
        }

        if (!this.tableIds[gameId]) {
            this.tableIds[gameId] = new Map();
        }

        this.tableIds[gameId].set(tableId, {level, currency, playerCount, betSettingUsedCid});
    } catch (err) {
        logger.error('[tableSearcher][setTableaAvail] tableId: %s, gameId: %s, currency: %s, err: ', tableId, gameId, currency, err);
    }
};

proto.deleteAvailTable = function (tableId, gameId) {
    try {
        logger.debug('tableSearcher.deleteAvailTable: tableId=%s', tableId);
        // this._ensureServer();

        if (!gameId) {
            throw new Error('tableSearcher wrong params 2 ' + gameId);
        }
        logger.info(`[tableSearcher][deleteAvailTable] serverId: ${this._app.getServerId()}, tableId: ${tableId}, gameId: ${gameId}, this.tableIds[gameId]:`, this.tableIds[gameId]);
        if (!this.tableIds[gameId]) {
            return false;
        }

        return this.tableIds[gameId].delete(tableId);
    } catch (err) {
        logger.error('[tableSearcher][deleteAvailTable] tableId: %s, gameId: %s, err: ', tableId, gameId, err);
    }
};

proto.getAvailTableIds = function (level, gameId, currency, maxChairs, betSettingUsedCid) {

    const ids = [];

    if (!gameId) {
        throw new Error('tableSearcher wrong params 3 ' + gameId);
    }

    if (!this.tableIds[gameId]) {
        return ids;
    }

    let array = [];
    let entries = this.tableIds[gameId].entries();
    for (let entry of entries) {
        array.push(entry);
    }

    let sortTables =
        new Map(array.sort((a, b) => {
            return a[1].playerCount < b[1].playerCount;
        }));

    let keys = sortTables.keys();

    for (let id of keys) {
        let table = this.tableIds[gameId].get(id);
        if (
            table.level === level &&                   // 同廳
            table.currency === currency &&             // 同幣別
            table.betSettingUsedCid === betSettingUsedCid && // 使用同一個用戶的投注設定
            table.playerCount < maxChairs             // 人數未滿
        ) {
            ids.push(id);
        }
    }

    logger.debug('tableSearcher.getAvailTableIds: tableIds=%j', ids);
    // this._ensureServer();
    return ids;

};

proto.acquireLockTable = async function (tableId, gameId, playerId, maxChairs) {

    logger.debug('[tableSearcher][acquireLockTable] tableId: %s, gameId: %s, playerId: %s, maxChairs: %s', tableId, gameId, playerId, maxChairs);
    // this._ensureServer();
    let playerCount = 0;

    if (!!this.tableIds[gameId]) {
        let table = this.tableIds[gameId].get(tableId);

        if (!!table) {
            playerCount += table.playerCount;
        }
    }

    if (!this.queues[tableId]) {
        this.queues[tableId] = [];
    }

    if (this.queues[tableId].length + playerCount >= maxChairs) {
        return P.resolve(false);
    }

    let len = this.queues[tableId].length;
    let prePlayer = len > 0 ? this.queues[tableId][len - 1] : null;
    let deferred = P.defer();

    this.queues[tableId].push({
        playerId,
        defer: deferred
    });

    return !!prePlayer ? prePlayer.defer.promise : P.resolve(true);

};

proto.releaseLockTable = async function (tableId, playerId) {

    logger.debug('[tableSearcher][releaseLockTable] tableId = %s, playerId = %s', tableId, playerId);
    // this._ensureServer();

    if (!this.queues[tableId]) {
        logger.error(`tableSearcher.releaseLockTable queue is null`)
        return false;
    }

    if (this.queues[tableId].length === 0) {
        logger.error(`tableSearcher.releaseLockTable queue is empty`)
        return false;
    }

    let frontPlayer = this.queues[tableId][0];

    if (frontPlayer.playerId !== playerId) {
        logger.error(`tableSearcher.releaseLockTable queue is empty`)
        return false;
    }
    this.queues[tableId].shift();

    frontPlayer.defer.resolve(true);
    return true
};


module.exports = function (app, opts) {
    let areaSearcher = new TableSearcher(app, opts);
    app.set(areaSearcher.name, areaSearcher, true);
    return areaSearcher;
};
