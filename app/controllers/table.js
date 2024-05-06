'use strict';

let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
// const uuid = require('uuid/v1');
const uuid = require('uuid/v5');
let logger = quick.logger.getLogger('connector', __filename);
let consts = require('../../share/consts');
const Mona = require("../dao/mona");
const {Ret, Format} = require("../utils/format-util");

const chanelPrefix = 'tb';
const MY_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

let Controller = function (app) {
    this.app = app;
    this.globalChannelService = app.get('globalChannelService');
    this.mona = new Mona({
        shardId: app.getServerId()
    });
};

module.exports = function (app) {
    return new Controller(app);
};

const proto = Controller.prototype;


proto.create = async function (playerId, connectorId, opts) {
    try {

        // somehow these codes will prevent table shard lock from releasing itself,
        // it is so ridiculous
        /*
        let table = new this.app.models.Table(opts);
        if (!table._id) {
            // table._id = uuid();
            table._id = uuid(playerId + Date.now() + opts.gameId, MY_NAMESPACE);
        }
        if (!table.name) {
            table.name = 'Auto';
        }
        await table.save();
         */


        const date = new Date();
        const data = Object.assign({}, opts);
        if (!data._id) {
            data._id = playerId + "#" + data.gameId + "#" + date.toISOString();
            // data._id = uuid(playerId + Date.now() + data.gameId, MY_NAMESPACE);
        }
        if (!data.name) {
            data.name = playerId + "#" + data.gameId;
        }
        data.createBy = playerId;
        data.createTime = date.toISOString();

        await this.mona.insert({
            schema: this.app.models.Table,
            id: data._id,
            data: data,
        });

        // await Ret.sleep(100);

        const table = await this.joinTable(
            data._id,
            playerId,
            connectorId,
            data.gameId,
            'create'
        );

        return table;
    } catch (ex) {
        logger.error('[table][create] playerId: %s, err: ', playerId, ex);
        throw ex;
    }
};


proto.createAsync = P.coroutine(function* (playerId, connectorId, opts) {
    try {
        let table = new this.app.models.Table(opts);
        if (!table._id) {
            // table._id = uuid();
            table._id = uuid(playerId + Date.now() + opts.gameId, MY_NAMESPACE);
        }
        if (!table.name) {
            table.name = 'Auto';
        }

        yield table.saveAsync();
        table = yield this.joinAsync(table._id, playerId, connectorId, opts.gameId, 'createAsync');
        return table;
    } catch (err) {
        logger.error('[table][createAsync] playerId: %s, err: ', playerId, err);
    }
});

proto.findReadOnlyAsync = P.coroutine(function* (tableId) {
    try {
        let table = yield this.app.models.Table.findByIdReadOnlyAsync(tableId);
        return table;
    } catch (err) {
        logger.error('[table][findReadOnlyAsync] tableId: %s, err: ', tableId, err);
    }
});

proto.findOneAsync = P.coroutine(function* (tableId) {
    let table = yield this.app.models.Table.findByIdAsync(tableId);
    return table;
});

proto.removeAsync = P.coroutine(function* (tableId) {
    try {
        let table = yield this.app.models.Table.findByIdAsync(tableId);
        if (!table) {
            throw new Error('table ' + tableId + ' not exist');
        }
        let playerIds = table.playerIds.filter((playerId) => playerId !== null);
        if (playerIds.length > 0) {
            throw new Error('table is not empty ');
        }
        yield table.removeAsync();
        // TODO: stop timer
    } catch (err) {
        logger.error('[table][removeAsync] tableId: %s, err: ', tableId, err);
    }
});


proto.joinTable = async function (
    tableId,
    playerId,
    connectorId,
    gameId,
    from,
    filterCb
) {

    try {
        logger.info("[joinTable] tableId start", tableId);
        const table = await this.mona.get({
            schema: this.app.models['Table'],
            id: tableId,
        });
        logger.info("[joinTable] tableId end", tableId, table);

        // let table = yield this.app.models.Table.findByIdAsync(tableId);

        if (!table) {
            let delTable = this.app.tableSearcher.deleteAvailTable(tableId, gameId); // 找不到該 table 刪除 Table cache
            // throw new Error('table ' + tableId + ' not exist ' + from + ' delete Table result: ' + delTable);
            logger.warn('[table][joinAsync] playerId: %s, err: table ' + tableId + ' not exist ' + from + ' delete Table result: ' + delTable);
            return null;
        }

        if (!!filterCb && !filterCb(table)) {
            return null;
        }

        // table.playerIds = table.playerIds.concat(playerId);
        let iRet = table.addPlayer(playerId);
        if (iRet === 0) {
            this.app.controllers.debug.info('warn', 'table.joinAsync', {
                playerId: playerId,
                tableId: tableId,
                connectorId: connectorId,
                reason: 'table is full',
            });
            return null;
        } else if (iRet === -1) {
            this.app.controllers.debug.info('error', 'table.joinAsync', {
                playerId: playerId,
                tableId: tableId,
                connectorId: connectorId,
                reason: 'player already in table',
            });
            throw new Error([playerId, ' already in table ', tableId].join());
        }

        await table.save();

        let channelId = chanelPrefix + tableId;
        // yield this.app.controllers.push.joinAsync(channelId, playerId, connectorId);
        //将玩家和connector关联
        this.globalChannelService.add(playerId, connectorId);
        //将玩家加入channel
        this.globalChannelService.add(channelId, playerId);

        this.app.controllers.debug.info('info', 'table.joinAsync', {
            playerId: playerId,
            tableId: tableId,
            connectorId: connectorId,
            from: from
        });


        return table;
    } catch (ex) {
        logger.error('[table][joinTable][catch] playerId: %s, err: %s\n stack:\n%s', playerId, ex.message, ex.stack);
        throw ex;
    }

};


proto.joinAsync = P.coroutine(function* (tableId, playerId, connectorId, gameId, from, filterCb) {
    try {
        let table = yield this.app.models.Table.findByIdAsync(tableId);
        if (!table) {
            let delTable = this.app.tableSearcher.deleteAvailTable(tableId, gameId); // 找不到該 table 刪除 Table cache
            // throw new Error('table ' + tableId + ' not exist ' + from + ' delete Table result: ' + delTable);
            logger.warn('[table][joinAsync] playerId: %s, err: table ' + tableId + ' not exist ' + from + ' delete Table result: ' + delTable);
            return null;
        }

        if (!!filterCb && !filterCb(table)) {
            return null;
        }

        // table.playerIds = table.playerIds.concat(playerId);
        let iRet = table.addPlayer(playerId);
        if (iRet === 0) {
            this.app.controllers.debug.info('warn', 'table.joinAsync', {
                playerId: playerId,
                tableId: tableId,
                connectorId: connectorId,
                reason: 'table is full',
            });
            return null;
        } else if (iRet === -1) {
            this.app.controllers.debug.info('error', 'table.joinAsync', {
                playerId: playerId,
                tableId: tableId,
                connectorId: connectorId,
                reason: 'player already in table',
            });
            throw new Error([playerId, ' already in table ', tableId].join());
        }
        yield table.saveAsync();

        let channelId = chanelPrefix + tableId;
        // yield this.app.controllers.push.joinAsync(channelId, playerId, connectorId);
        //将玩家和connector关联
        this.globalChannelService.add(playerId, connectorId);
        //将玩家加入channel
        this.globalChannelService.add(channelId, playerId);

        this.app.controllers.debug.info('info', 'table.joinAsync', {
            playerId: playerId,
            tableId: tableId,
            connectorId: connectorId,
            from: from
        });
        return table;
    } catch (err) {
        logger.error('[table][joinAsync][catch] playerId: %s, err: ', playerId, err);
    }
});

proto.quitAsync = P.coroutine(function* (tableId, playerId, connectorId) {
    try {
        let table = _.isString(tableId) ? yield this.app.models.Table.findByIdAsync(tableId) : tableId;

        if (!table) {
            return null;
        }

        let channelId = chanelPrefix + tableId;
        // yield this.app.controllers.push.quitAsync(channelId, playerId);
        // if (!!connectorId) {
        //   this.globalChannelService.leave(playerId, connectorId);
        // }

        this.globalChannelService.leave(channelId, playerId);

        let idx = _.indexOf(table.playerIds, playerId);
        if (idx === -1) {
            // throw new Error('player id must in table.playerIds: tableId=' + tableId + ', playerId=' + playerId);
            logger.warn('[table][quitAsync] player id must in table.playerIds: tableId=' + tableId + ', playerId:' + playerId);
            return;
        }
        // table.playerIds.splice(_.indexOf(table.playerIds, playerId), 1);
        // table.markModified('playerIds');
        table.removePlayer(playerId);
        yield table.saveAsync();

        if (table.playerCount() === 0) {
            logger.info(`[table][quitAsync] memdb table removeAsync. playerId: ${playerId}, tableId: ${table._id}, serverId: ${this.app.getServerId()}, table:`, JSON.stringify(table));
            // if no one left in the team, remove the team
            yield this.removeAsync(table._id);
        } else {
            if (playerId === table.hostId) {
                // if host left, choose another host
                table.hostId = table.chooseHost(idx);
                if (!table.hostId) {
                    throw new Error(util.format('chooseHost return null: tableId=%s, idx=%s', tableId, idx));
                }
                yield table.saveAsync();
            }
        }
        return table;
    } catch (err) {
        logger.error('[table][quitAsync] playerId: %s, tableId: %s, connectorId: %s, err: ', playerId, tableId, connectorId, err);
    }
});

// proto.getPlayersAsync = P.coroutine(function*(tableId) {
//   let table = _.isString(tableId) ? yield this.app.models.Table.findByIdReadOnlyAsync(tableId) : tableId;
//   if (!table) {
//     throw new Error('table ' + tableId + ' not exist');
//   }
//
//   return table.playerIds;
// });

// proto.internalUpdateAsync = P.coroutine(function*(tableId, opts) {
//   let table = yield this.app.models.Table.findByIdAsync(tableId);
//   if (!table) {
//     logger.warn('table %s not exist ', tableId);
//     return null;
//     // throw new Error('table ' + playerId + ' not exist');
//   }
//   this.app.models.Table.getInternalUpdatableKeys().forEach(function (key) {
//     if (opts.hasOwnProperty(key)) {
//       table[key] = opts[key];
//     }
//   });
//
//   yield table.saveAsync();
//
//   return table;
// });


proto.pushTable = async function (tableId, playerIds, route, msg, persistent) {
    try {
        const self = this;
        let channelId = '';
        let players = [];
        if (_.isString(tableId)) {
            channelId = chanelPrefix + tableId;
            //获取channel里的玩家列表
            players = await self.globalChannelService.getSidsByUid(channelId);
        } else {
            for (let tId of tableId) {
                channelId = chanelPrefix + tId;
                // 獲取channel(每一桌)裡的玩家列表
                let tablePlayers = await self.globalChannelService.getSidsByUid(channelId);
                players = players.concat(tablePlayers); // 將玩家存入要送訊息的玩家列表裡
            }
        }

        if (!!playerIds && playerIds.length > 0) {
            playerIds.forEach((value) => {
                players = players.filter((id) => {
                    return id !== value
                })
            })
        }

        // 因有先做 playerId 的過濾，所以將此判斷移至下面再做，以防過濾完後 players 是空的會跑錯誤
        if (players.length === 0) {
            return null;
        }

        if (route !== consts.route.client.game.SPAWN_FISHES) {
            this.app.controllers.debug.serverpush(
                route,
                JSON.stringify({msg: msg}),
                JSON.stringify(players)
            );
        }
        const content = { msg: msg };
        logger.info("[table][pushTable]", playerIds, route, content);
        return this.globalChannelService.pushMessageByUidArr(players, route, content);
    } catch (ex) {
        logger.error('[table][pushTable] msg: %s, err: ', JSON.stringify(msg), ex);
        throw ex;
    }
};


/**
 * playerIds - [playerId], set null to push all
 */
proto.pushAsync = P.coroutine(function* (tableId, playerIds, route, msg, persistent) {
    try {
        const self = this;
        let channelId = '';
        let players = [];
        if (_.isString(tableId)) {
            channelId = chanelPrefix + tableId;
            //获取channel里的玩家列表
            players = yield self.globalChannelService.getSidsByUid(channelId);
        } else {
            for (let tId of tableId) {
                channelId = chanelPrefix + tId;
                // 獲取channel(每一桌)裡的玩家列表
                let tablePlayers = yield self.globalChannelService.getSidsByUid(channelId);
                players = players.concat(tablePlayers); // 將玩家存入要送訊息的玩家列表裡
            }
        }

        if (!!playerIds && playerIds.length > 0) {
            playerIds.forEach((value) => {
                players = players.filter((id) => {
                    return id !== value
                })
            })
        }

        // 因有先做 playerId 的過濾，所以將此判斷移至下面再做，以防過濾完後 players 是空的會跑錯誤
        if (players.length <= 0) {
            return null;
        }

        if (route !== consts.route.client.game.SPAWN_FISHES) {
            this.app.controllers.debug.serverpush(
                route,
                JSON.stringify({msg: msg}),
                JSON.stringify(players)
            );
        }

        const content = { msg: msg };
        logger.info("[table][pushAsync]", players, route, content);
        return this.globalChannelService.pushMessageByUidArr(players, route, content );
    } catch (err) {
        logger.error('[table][pushAsync] msg: %s, err: ', JSON.stringify(msg), err);
    }
});

// proto.getMsgsAsync = P.coroutine(function*(tableId, seq, count) {
//   let channelId = chanelPrefix + tableId;
//   return yield this.app.controllers.push.getMsgsAsync(channelId, seq, count);
// });
