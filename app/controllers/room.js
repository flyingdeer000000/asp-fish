let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
const uuid = require('uuid/v1')
let logger = quick.logger.getLogger('connector', __filename);


let Controller = function (app) {
    this.app = app;
    this.defaultConfig = {maxChairs: 2};
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;


proto.searchAndJoin = async function (playerId, connectorId, gameId, opts) {
    try {
        // let control = this.app.controllers.table;
        // let config = this.app.get('roomConfig');
        // config = config[this.app.getServerId()] || this.defaultConfig;
        opts = opts || {level: 0}
        opts['gameId'] = gameId;

        const config = this.app.controllers.fishHunterConfig.getRoomConfig(gameId);
        const maxChairs = config.room[opts.level].maxChairs || this.defaultConfig;
        const tableIds = this.app.tableSearcher.getAvailTableIds(opts.level, gameId, opts.currency, maxChairs, opts.betSettingUsedCid);
        let table;

        for (let tableId of tableIds) {
            // TODO
            table = await this.joinTable(tableId, playerId, connectorId, opts, maxChairs, opts.betSettingUsedCid);

            if (!!table) {
                return table;
            }
        }

        let data = {
            serverId: this.app.getServerId(),
            gameId: opts.gameId,
            level: opts.level,
            currency: opts.currency,
            betSettingUsedCid: opts.betSettingUsedCid
        };
        // TODO
        const ret = await this.createTable(playerId, connectorId, data);

        return ret;

    } catch (err) {
        logger.error('[room][searchAndJoin] playerId: %s, err: ', playerId, err);
        throw err;
    }
}


proto.searchAndJoinAsync = P.coroutine(function* (playerId, connectorId, gameId, opts) {
    try {
        // let control = this.app.controllers.table;
        // let config = this.app.get('roomConfig');
        // config = config[this.app.getServerId()] || this.defaultConfig;
        opts = opts || {level: 0}
        opts['gameId'] = gameId;

        let config = this.app.controllers.fishHunterConfig.getRoomConfig(gameId);
        let maxChairs = config.room[opts.level].maxChairs || this.defaultConfig;
        let tableIds = this.app.tableSearcher.getAvailTableIds(opts.level, gameId, opts.currency, maxChairs, opts.betSettingUsedCid);
        let table;
        for (let tableId of tableIds) {
            table = yield this.joinTableAsync(tableId, playerId, connectorId, opts, maxChairs, opts.betSettingUsedCid);

            if (!!table) {
                return table;
            }
        }

        let data = {
            serverId: this.app.getServerId(),
            gameId: opts.gameId,
            level: opts.level,
            currency: opts.currency,
            betSettingUsedCid: opts.betSettingUsedCid
        };
        return yield this.createTableAsync(playerId, connectorId, data);
    } catch (err) {
        logger.error('[room][searchAndJoinAsync] playerId: %s, err: ', playerId, err);
        throw err;
    }
});


proto.createTable = async function (playerId, connectorId, opts) {

    opts = opts || {level: 0};
    const tableConrol = this.app.controllers.table;
    let config = this.app.controllers.fishHunterConfig.getRoomConfig(opts.gameId);
    let level = opts.level || 1;
    config = config.room[level] || this.defaultConfig;
    opts.maxChairs = config.maxChairs;
    const table = await tableConrol.create(playerId, connectorId, opts);

    // 設定桌子 cache 人數
    this.app.tableSearcher.setTableaAvail(
        table._id,
        opts.level,
        opts.gameId,
        opts.currency,
        table.playerCount(),
        opts.betSettingUsedCid
    );

    return table ? table.toClientData() : null

};


proto.createTableAsync = P.coroutine(function* (playerId, connectorId, opts) {
    try {
        opts = opts || {level: 0};
        let control = this.app.controllers.table;
        let config = this.app.controllers.fishHunterConfig.getRoomConfig(opts.gameId);
        let level = opts.level || 1;
        config = config.room[level] || this.defaultConfig;
        opts.maxChairs = config.maxChairs;
        let table = yield control.createAsync(playerId, connectorId, opts);

        // 設定桌子 cache 人數
        this.app.tableSearcher.setTableaAvail(table._id, opts.level, opts.gameId, opts.currency, table.playerCount(), opts.betSettingUsedCid);

        return table ? table.toClientData() : null
    } catch (err) {
        logger.error('[room][createTableAsync] playerId: %s, err: ', playerId, err);
    }
});


proto.joinTable = async function (tableId, playerId, connectorId, opts, maxChairs, betSettingUsedCid) {

    const tableSearcher = this.app['tableSearcher'];

    try {

        const tableControl = this.app.controllers.table;
        // let table = yield control.findReadOnlyAsync(tableId);
        // if(table && table.playerCount() < config.maxChairs) {
        //     table = yield control.joinAsync(table._id, playerId,connectorId);
        // }

        // TODO acquire lock

        const success = await tableSearcher.acquireLockTable(tableId, opts.gameId, playerId, maxChairs);
        if (!success) {
            return false;
        }


        const table = await tableControl.joinTable(
            tableId,
            playerId,
            connectorId,
            opts.gameId,
            'joinTable',
            (tb) => {
                if (tb && tb.level === opts.level) {
                    return true;
                }
                return false;
            });

        let config = null;

        if (!!table) {
            config = this.app.controllers.fishHunterConfig.getRoomConfig(table.gameId);
            config = config.room[table.level] || this.defaultConfig;

            // 更新桌子 cache 人數
            this.app.tableSearcher.setTableaAvail(table._id, opts.level, table.gameId, opts.currency, table.playerCount(), betSettingUsedCid);
        }

        // if(!!table && table.playerCount() >= config.maxChairs) {
        //     this.app.tableSearcher.deleteAvailTable(table._id,table.gameId); // 不能刪
        // }

        return table ? table.toClientData() : null;

    } catch (err) {
        logger.warn('[room][joinTableAsync] playerId: %s, err: %s\n, stack:\n%s', playerId, err.message, err.stack);
        throw err;
    } finally {
        // TODO release lock
        tableSearcher.releaseLockTable(tableId, playerId);
    }
};

proto.joinTableAsync = P.coroutine(function* (tableId, playerId, connectorId, opts, maxChairs, betSettingUsedCid) {
    try {
        let control = this.app.controllers.table;
        // let table = yield control.findReadOnlyAsync(tableId);
        // if(table && table.playerCount() < config.maxChairs) {
        //     table = yield control.joinAsync(table._id, playerId,connectorId);
        // }

        let succ = yield this.app.tableSearcher.acquireLockTableAsync(tableId, opts.gameId, playerId, maxChairs);
        if (!succ) {
            return false;
        }

        let table = yield control.joinAsync(tableId, playerId, connectorId, opts.gameId, 'joinTableAsync', (tb) => {
            if (tb && tb.level == opts.level) {
                return true;
            }

            return false;
        });

        let config = null;

        if (!!table) {
            config = this.app.controllers.fishHunterConfig.getRoomConfig(table.gameId);
            config = config.room[table.level] || this.defaultConfig;

            // 更新桌子 cache 人數
            this.app.tableSearcher.setTableaAvail(table._id, opts.level, table.gameId, opts.currency, table.playerCount(), betSettingUsedCid);
        }

        this.app.tableSearcher.releaseLockTable(tableId, playerId);

        // if(!!table && table.playerCount() >= config.maxChairs) {
        //     this.app.tableSearcher.deleteAvailTable(table._id,table.gameId); // 不能刪
        // }

        return table ? table.toClientData() : null;
    } catch (err) {
        logger.warn('[room][joinTableAsync] playerId: %s, err: ', playerId, err);

        this.app.tableSearcher.releaseLockTable(tableId, playerId);

        return null;
    }
});

proto.quitTableAsync = P.coroutine(function* (tableId, playerId, connectorId, betSettingUsedCid) {
    try {
        let control = this.app.controllers.table;
        let config = null;
        let table = yield control.quitAsync(tableId, playerId, connectorId);

        if (!!table) {
            let level = table.level;
            config = this.app.controllers.fishHunterConfig.getRoomConfig(table.gameId);
            config = config.room[level] || this.defaultConfig;
        }

        // if (table && table.playerCount() < config.maxChairs && table.playerCount() != 0) {
        //   if (table.recycle) {
        //     this.app.tableSearcher.setTableaAvail(table._id, table.level, table.gameId, table.currency, table.playerCount(), betSettingUsedCid);
        //   }
        // }
        // else {
        //   this.app.tableSearcher.deleteAvailTable(!!table ? table._id : tableId, table.gameId);
        // }
        //
        // return table ? table.toClientData() : null;

        if (table) {
            if (table.playerCount() < config.maxChairs && table.playerCount() > 0) {
                // 更新
                if (table.recycle)
                    this.app.tableSearcher.setTableaAvail(table._id, table.level, table.gameId, table.currency, table.playerCount(), betSettingUsedCid);
            } else {
                // 刪除
                let delTable = this.app.tableSearcher.deleteAvailTable(table._id, table.gameId);
                logger.info(`[room][quitTableAsync] playerId: ${playerId}, tableId: ${tableId}, delTable: ${delTable}, table:`, table);
            }
            return table.toClientData();
        } else {
            throw ('table not exist, tableId = ' + tableId);
        }
    } catch (err) {
        logger.error('[room][quitTableAsync] playerId: %s, err: ', playerId, err);
        return null;
    }
});

