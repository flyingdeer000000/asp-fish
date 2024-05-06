'use strict';

let quick = require('quick-pomelo');
let P = quick.Promise;
let _ = require('lodash');
let md5 = require('md5');
let uuid = require('node-uuid');
let C = require('../../share/constant');
let logger = quick.logger.getLogger('player', __filename);
let cort = P.coroutine;

let Controller = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
/*
// 创建玩家
proto.createAsync = P.coroutine(function* (playerId, name, sex, headurl, spread, ip) {
    if (!name) name = 'User' + _.random(100000, 999999);
    let account = md5(playerId).toLowerCase();
    let player = new this.app.models.Player({
        _id: playerId,
        account: account,
        sex: sex || '0',
        name: name,
        registerIp: ip,
        headurl: headurl || '',
        spreader: spread || ''
    });
    let pos = playerId.lastIndexOf('@');
    if (-1 != pos && '@ai2016' == playerId.substr(pos)) {
        player.vip = _.random(0, 5);
        player.gold = _.random(50000000, 1500000000);
    }
    yield player.saveAsync();
    yield this.app.controllers.hall.initTaskAsync(playerId);
    let channelId = 'p:' + playerId;
    yield this.app.controllers.push.joinAsync(channelId, playerId);
    return player;
});

// 移除玩家
proto.removeAsync = P.coroutine(function* (playerId) {
    let player = yield this.app.models.Player.findByIdAsync(playerId);
    if (player) {
        let channelId = 'p:' + playerId;
        yield this.app.controllers.push.quitAsync(channelId, playerId);
        return player.removeAsync();
    }
});
*/
// 连接频道
proto.connectAsync = function (playerId, connectorId, ip) {
    let player = null;
    let oldConnectorId = null;
    let oldGameId = 0;
    let oldGameSvrId = null;

    return P.bind(this)
        .then(function () {
            return this.app.models.Player.findByIdAsync(playerId, 'gold connectorId gameId gameServerId onlineTime lastLoginTime todayGold fortuneTimes lastLoginIp');
        })
        .then(function (ret) {
            player = ret;
            if (!player) {
                throw new Error('player ' + playerId + ' not exist');
            }
            oldConnectorId = player.connectorId;
            oldGameId = player.gameId;
            oldGameSvrId = player.gameServerId;

            let nowTime = new Date();
            let lastTime = new Date(player.lastLoginTime);
            if (nowTime.getMonth() != lastTime.getMonth() || nowTime.getDate() != lastTime.getDate()) {
                player.onlineTime = 0;
                player.todayGold = player.gold;
                if (player.fortuneTimes < 3) player.fortuneTimes += 1;
            }
            player.lastLoginIp = ip;
            player.connectorId = connectorId;
            player.lastLoginTime = nowTime.getTime();
            return player.saveAsync();
        })
        .then(function () {
            return this.app.controllers.push.connectAsync(playerId, connectorId);
        })
        .then(function () {
            logger.info('connect %s %s => %s', playerId, connectorId, oldConnectorId);
            return {
                oldConnectorId: oldConnectorId,
                oldGameId: oldGameId,
                oldGameSvrId: oldGameSvrId
            };
        });
};

// 断开频道
// proto.disconnectAsync = function (playerId) {
//     let player = null;
//     let oldGameId = 0;
//     let oldGameSvrId = null;
//
//     return P.bind(this)
//         .then(function () {
//             return this.app.models.Player.findByIdAsync(playerId);
//         })
//         .then(function (ret) {
//             player = ret;
//             if (!player) {
//                 throw new Error('player ' + playerId + ' not exist');
//             }
//             oldGameId = player.gameId;
//             oldGameSvrId = player.gameServerId;
//
//             player.connectorId = '';
//             let nowTime = Date.now();
//             let lastTime = player.lastLoginTime;
//             let onlineTime = player.onlineTime;
//             player.onlineTime += (nowTime - lastTime);
//             if (player.fortuneTimes < 3 && onlineTime < 3600000 && player.onlineTime > 3600000) {
//                 player.fortuneTimes += 1;
//             }
//             player.offlineTime = nowTime;
//             return player.saveAsync();
//         })
//         .then(function () {
//             return this.app.controllers.push.disconnectAsync(playerId);
//         })
//         .then(function () {
//             return this.app.models.Reward.findByIdAsync('dashang');
//         })
//         .then(function (rew) {
//             if (rew) {
//                 let remove_index = _.findIndex(rew.rewards, function (n) { return n._id == playerId });
//                 if (remove_index != -1) {
//                     rew.rewards.splice(remove_index, 1);
//                     return rew.saveAsync();
//                 }
//             }
//         })
//         .then(function () {
//             logger.info('disconnect %s', playerId);
//             return {
//                 oldGameId: oldGameId,
//                 oldGameSvrId: oldGameSvrId
//             };
//         });
// };

// 推送消息
proto.pushAsync = function (playerId, route, msg) {
    let channelId = 'p:' + playerId;
    return this.app.controllers.push.pushAsync(channelId, null, route, msg, false);
};

// 获取消息
// proto.getMsgsAsync = function (playerId, seq, count) {
//     let channelId = 'p:' + playerId;
//     return this.app.controllers.push.getMsgsAsync(channelId, seq, count);
// };

// 取得投注設定 (由 session)
proto.getBetSetting = cort(function* (playerId, connectorId) {
    try {
        const sessions = yield this.getSession(playerId, connectorId);
        if (!sessions) return null;
        return sessions.get('betSetting');
    } catch (err) {
        logger.error(`[player][getBetSetting] playerId: ${playerId}, connectorId: ${connectorId}, err: ${err}`);
        return null;
    }
});

// 取得 session
proto.getSession = cort(function* (playerId, connectorId) {
    try {
        if (!playerId) {
            logger.error(`[player][getSession] no playerId! connectorId: ${connectorId}`);
            return null;
        }

        let sessions;
        if (this.app.isFrontend()) {
            let ss = this.app.get('sessionService');
            sessions = ss.getByUid(playerId);
        } else {
            if (!connectorId) {
                connectorId = yield this.app.get('globalChannelService').getSidsByUid(playerId); // connectorId = ['connector-server-1']
                if (connectorId.length > 1) {
                    logger.warn(`[player][getSession] playerId: ${playerId}, connectorId:`, connectorId);
                    connectorId = connectorId[0];
                }
            }
            if (!connectorId) {
                logger.error(`[player][getSession] not found connectorId! playerId: ${playerId}`);
                return null;
            }
            if (_.isArray(connectorId) && connectorId.length == 0) return null;

            let bss = this.app.get('backendSessionService');
            sessions = yield P.promisify(bss.getByUid, bss)(connectorId, playerId);
        }

        if (!sessions || sessions.length === 0) {
            logger.warn(`[player][getSession] cannot get session! playerId: ${playerId}, connectorId: ${connectorId}, isFrontend: ${this.app.isFrontend()}`);
            return null;
        }
        return sessions[0];
    } catch (err) {
        logger.error(`[player][getSession] playerId: ${playerId}, connectorId: ${connectorId}, err: ${err}`);
        return null;
    }
});

proto.getSessionOnlinePlayers = async function (connectorId) {
    try {
        let self = this;
        let rpcEntry = self.app.rpc.connector.accountRemote;
        let onlinePlayers = [];
        let connectors = [{id: connectorId}];
        // 取全伺服器玩家
        if (typeof connectorId == 'undefined') {
            connectors = self.app.getServersByType('connector');
        } else if (connectorId == '') return [];

        for (let i = 0; i < connectors.length; i++) {
            let players = await P.promisify(rpcEntry.getOnlinePlayers, rpcEntry)({frontendId: connectors[i].id});
            for (let j = 0; j < players.length; j++) {
                onlinePlayers.push(players[j]);
            }
        }
        return onlinePlayers;
    } catch (err) {
        logger.error(`[player][getSessionOnlinePlayers] connectorId: ${connectorId}, err: ${err}`);
        return [];
    }
};