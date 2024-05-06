'use strict';
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let util = require('util');
let C = require('../../share/constant');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('connector', __filename);
let utils = require('../utils/utils');
const Mona = require("../dao/mona");
let m_objRNGMethod;

let Controller = function (app) {
    this.app = app;
    this.webConnectorCls = this.app.get('WebConnectorCls'); //無用
    this.bulletCounter = utils.intCounter();       //子彈計數器
    this.bulletIndexCache = utils.bulletIndexCache(); //子彈Cache
    this.bulletIndexCache.start();
    this.tokensVoucher = utils.intCounter();          //token 對照
    let strRNGPath = null;
    if (!app || app.controllers.RNGPath)
        strRNGPath = '../lib/RNG/GameLogicInterface';
    else
        strRNGPath = './lib/RNG/GameLogicInterface';
    // strRNGPath = app.getBase() + '/lib/RNG/GameLogicInterface';
    m_objRNGMethod = utils.randProbability.loadRNGDll(strRNGPath);

    this.mona = new Mona({
        shardId: app.getServerId()
    });

};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

proto.transactionAsync = function (handlerFun) {
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        return handlerFun();
    }), app.getServerId())
        .then((res) => {
            app.event.emit('transactionSuccess');
            return res;
        })
        .catch((err) => {
            app.event.emit('transactionFail');
            //logger.error('transactionAsync reject ', err);
            return {error: C.ERROR};
        });
};

proto.createTableAsync = cort(function* (player) {
    if (!!player.tableId) {
        return {error: C.TABLE_HAS_ALREADY};
    }

    if (player.gameState != '' && player.gameState != consts.GameState.FREE) {
        return {error: C.PLAYER_NOT_FREE}
    }

    if (!player.gameId || !player.connectorId) {
        return {error: C.PLAYER_NOT_LOGIN};
    }

    let roomControl = this.app.controllers.room;
    let table = yield roomControl.createTableAsync(player._id, player.connectorId, {
        serverId: this.app.getServerId(),
        gameId: player.gameId,
        recycle: false
    });

    if (!table) {
        return {error: C.ERROR};
    }

    let playerControl = this.app.controllers.fishHunterPlayer;
    yield playerControl.internalUpdateAsync(playerId, {tableId: table._id});

    let players = [player.toClientData()];
    return {error: null, data: {table: table, players: players}};
});

// proto.joinTableAsync = cort(function*(tableId, player) {
//
//   if (!!player.tableId) {
//     return {error: C.TABLE_HAS_ALREADY};
//   }
//
//   if (player.gameState != '' && player.gameState != consts.GameState.FREE) {
//     return {error: C.PLAYER_NOT_FREE}
//   }
//
//   if (!player.gameId || !player.connectorId) {
//     return {error: C.PLAYER_NOT_LOGIN};
//   }
//
//   let roomControl = this.app.controllers.room;
//   let table = yield roomControl.joinTableAsync(tableId, player._id, player.connectorId);
//
//   if (!table) {
//     return {error: C.ERROR};
//   }
//
//   let playerControl = this.app.controllers.fishHunterPlayer;
//   yield playerControl.internalUpdateAsync(playerId, {tableId: table._id});
//
//   let players = yield this.pushTableMsgAsync(player, table, consts.route.client.table.JOIN, true);
//   players = players.players;
//
//   return {error: null, data: {table: table, players: players}};
// });

// proto.settleToPlatformAsync = function (player,accessToken) {
//
//   if(!accessToken) {
//     //logger.warn('settleToPlatformAsync no accessToken ', player._id);
//     return {error:C.FAILD};
//   }
//
//   let self = this;
//   let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
//
//   if (!config) {
//     //logger.error('settleToPlatform no server config ',player._id,' ');
//     return {error:C.FAILD};
//   }
//
//   return {error:null};
// }

// proto._buildBulletIndexCache = function (playerId, maxCount) {
//   let self = this;
//
//   return self.app.memdb.goose.transactionAsync(cort(function*() {
//     let cache = self.bulletIndexCache.getAll(playerId);
//     if (!!cache && _.isEmpty(cache)) {
//       return {error: C.GAME_BET_COOL_DOWN};
//     }
//
//     if (Object.keys(cache).length == maxCount) {
//       return {error: null};
//     }
//
//     let modelBullets = self.app.models.FishHunterBullets;
//     self.bulletIndexCache.removeAll(playerId);
//     self.bulletIndexCache.add(playerId, {});
//
//     let indexCache = {};
//
//     for (let i = 0; i < maxCount; i++) {
//       let bullet = yield modelBullets.findByIdAsync(playerId + i);
//       if (!bullet) {
//         bullet = new modelBullets({
//           _id: playerId + i,
//           playerId: playerId,
//           bulletId: 0,
//         });
//         yield bullet.saveAsync();
//       }
//       indexCache[i] = bullet.bulletId;
//     }
//     self.bulletIndexCache.add(playerId, indexCache);
//
//     return {error: null};
//   }), self.app.getServerId());
// };

// proto._onSpawnBullet = cort(function*(id, bulletData) {
//   let self = this;
//   let modelBullets = self.app.models.FishHunterBullets;
//
//   let b = yield modelBullets.findByIdAsync(id);
//   if (!b) {
//     return {error: C.FAILD};
//   }
//
//   if (b.bulletId != 0) {
//     //logger.error('_onSpawnBullet bulletId in userd ', b);
//     return {error: C.FAILD};
//   }
//
//   for (let p in bulletData) {
//     b[p] = bulletData[p];
//   }
//
//   yield b.saveAsync();
//   return {error: null};
// });

proto._onUpdateAreaPlayer = cort(function* (queryOrId, opts) {
    let self = this;

    let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
    let areaPlayer = yield modelAreaPlayers.findOneAsync(queryOrId);

    if (!!areaPlayer) {
        if (!!opts.cost) {
            areaPlayer.cost = utils.number.add(areaPlayer.cost, opts.cost);
        }

        if (!!opts.lastFireTime) {
            areaPlayer.lastFireTime = opts.lastFireTime;
        }

        if (!!opts.gain) {
            areaPlayer.gain = utils.number.add(areaPlayer.gain, opts.gain);
        }

        yield areaPlayer.saveAsync();

        return {error: null, data: {areaPlayerId: queryOrId}}
    } else {
        //logger.error('_onUpdateAreaPlayer areaPlayer ', queryOrId, ' opts ', opts);
        return {error: C.ERROR};
    }
});

proto._onDestroyBullet = cort(function* (playerId, bulletId) {
    logger.error('********************_onDestroyBullet unimplement************************************')
    // let ret = {error: null};
    // let bIndex = -1;
    // let indexCache = this.bulletIndexCache.getAll(playerId);
    //
    // if (!indexCache) {
    //   return {error: C.ERROR};
    // }
    //
    // for (let idx in indexCache) {
    //   if (indexCache[idx] == bulletId) {
    //     bIndex = idx;
    //     break;
    //   }
    // }
    //
    // if (bIndex == -1) {
    //   //logger.error(playerId, ' bullet not in cache ', bulletId);
    //
    //   return {error: C.ILLEGAL};
    // }
    //
    // let bullet = yield this.app.models.FishHunterBullets.findByIdAsync(playerId + bIndex);
    // if (bullet && bullet.bulletId != 0) {
    //   let data = bullet.toObject();
    //
    //   bullet.bulletId = 0;
    //   bullet.cost = 0;
    //   yield bullet.saveAsync();
    //
    //   this.bulletCounter.minus(playerId, bulletId);
    //   this.bulletIndexCache.set(playerId, bIndex, 0);
    //
    //   ret = {error: null, data: data};
    // }
    // else {
    //   //logger.error(playerId, ' illegal bullet ', bulletId, ' bullet ', bullet);
    //
    //   ret = {error: C.ILLEGAL};
    // }
    // return ret;
});

proto.updateAreaPlayerGain = cort(function* (areaId, playerId, gain) {
    let self = this;

    return self.app.memdb.goose.transactionAsync(cort(function* () {
        let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
        let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: areaId, playerId: playerId});

        if (!!areaPlayer) {
            areaPlayer.gain = utils.number.add(areaPlayer.gain, gain);

            yield areaPlayer.saveAsync();
        }

    }), self.app.getServerId())
        .then(() => {
            self.app.event.emit('transactionSuccess')
        })
        .catch((err) => {
            self.app.event.emit('transactionFail');
            //logger.error('updateAreaPlayerGain reject ', err);
        });
});

proto.onUpdateCannonAsync = cort(function* (player, upgrade, betSetting) {
    try {
        if (!player.tableId) {
            return {error: C.TABLE_NOT_FOUND};
        }

        if (player.gameState != consts.GameState.PLAYING) {
            return {error: C.PLAYER_NOT_PLAYING};
        }

        //logger.info('player ', player._id, ' cannon upgrade ', upgrade);

        let self = this;
        let area = yield this.app.controllers.standUp._findStartedAreaAsync(player.tableId);

        if (!area || area.length == 0) {
            return {error: C.FISH_AREA_HAS_COMPLETED};
        }
        area = area[0];

        let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
        let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: area._id, playerId: player._id});

        if (!areaPlayer) {
            return {error: C.PLAYER_NOT_PLAYING}
        }

        if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
            logger.error(`[fishHunterGame][onUpdateCannonAsync] no betSetting! playerId: ${player._id}`);
            return {error: C.ERROR};
        }
        // let currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfigByDC(player.dc);
        // if (!currencyConfig) currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfig();
        // let costList = currencyConfig[(player.currency?player.currency:'CNY')].cannon.cost[player.tableLevel];
        let costList = betSetting.info.levels[player.tableLevel].cannon.cost;


        // if (upgrade) {
        //   ++areaPlayer.cannonLevel;
        //
        //   if (areaPlayer.cannonLevel >= costList.length) {
        //     areaPlayer.cannonLevel = 0;
        //   }
        // }
        // else {
        //   --areaPlayer.cannonLevel;
        //
        //   if (areaPlayer.cannonLevel < 0) {
        //     areaPlayer.cannonLevel = utils.number.sub(costList.length, 1);
        //   }
        // }

        // 取memWallet來檢查餘額
        let memWallet;
        let backend = yield self.app.controllers.fishHunterPlayer.getBackendSessions_rpc(player);
        if (!!backend && !!backend.sessions && backend.sessions.length > 0 && !!backend.sessions[0].get('fireServer')) {
            // call rpc 取得目前最新餘額
            memWallet = yield P.promisify(backend.rpc.getWalletAsync.toServer, backend.rpc.getWalletAsync)(
                backend.sessions[0].get('fireServer'), player._id, player.gameId, false, null, null
            );
            if (memWallet.error != C.OK) {
                logger.warn('[fishHunterGame][onUpdateCannonAsync] getMemWallet fail. playerId: %s, gameId: %s, fireServer: %s, memWallet: ', player._id, player.gameId, backend.sessions[0].get('fireServer'), memWallet);
                return {error: C.ERROR};
            }
        } else {
            // 玩家不在遊戲內
            logger.warn(`[fishHunterGame][onUpdateCannonAsync] playerId: ${player._id}, gameId: ${player.gameId}, backend:`, backend);
            return {error: C.FAILD};
        }

        // 至少20倍
        const GAP = 20;
        let cannon = {
            cost: betSetting.info.levels[player.tableLevel].cannon.cost,
            level: betSetting.info.levels[player.tableLevel].cannon.level
        };

        // 若額度/押注低於20倍將強制調整押注大小
        let i = 0;
        while (
            (upgrade && memWallet.data.balance / (cannon.cost[++areaPlayer.cannonLevel >= costList.length ? areaPlayer.cannonLevel = 0 : areaPlayer.cannonLevel]) < GAP)
            || (!upgrade && (memWallet.data.balance / (cannon.cost[--areaPlayer.cannonLevel < 0 ? areaPlayer.cannonLevel = utils.number.sub(costList.length, 1) : areaPlayer.cannonLevel]) < GAP))) {
            logger.warn('[fishHunterGame][onUpdateCannonAsync] 餘額/押注低於 %s 倍，強制校正. playerId: %s, gameId: %s, fireServer: %s, balance: %s, cost: ', GAP, player._id, player.gameId, backend.sessions[0].get('fireServer'), memWallet.data.balance, cannon.cost[areaPlayer.cannonLevel]);
            if (areaPlayer.cannonLevel == 0) {
                logger.warn('[fishHunterGame][onUpdateCannonAsync] 餘額/押注低於 %s 倍，強制為房間最低押注. playerId: %s, gameId: %s, fireServer: %s, balance: %s, cost: ', GAP, player._id, player.gameId, backend.sessions[0].get('fireServer'), memWallet.data.balance, cannon.cost[areaPlayer.cannonLevel]);
                break;
            }

            // 保護while避免無窮迴圈
            i++;
            if (i > 30)
                return {error: C.ERROR};
        }

        yield areaPlayer.saveAsync();

        // 資訊送給同房玩家
        this.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_CANNON, {areaPlayer: areaPlayer.toClientData(betSetting)}, false);

        return {error: null, data: {areaPlayer: areaPlayer.toClientData(betSetting)}};
    } catch (err) {
        logger.error(`[fishHunterGame][onUpdateCannonAsync] playerId: ${player._id}, gameId: ${player.gameId}, err:`, err);
        return {error: C.ERROR};
    }
});

proto.onLockTargetAsync = cort(function* (player, lock, betSetting) {
    if (!player.tableId) {
        return {error: C.TABLE_NOT_FOUND};
    }

    if (player.gameState != consts.GameState.PLAYING) {
        return {error: C.PLAYER_NOT_PLAYING};
    }

    //logger.info('onLockTargetAsync player ', player._id, ' lock ', lock);

    let self = this;
    let area = yield this.app.controllers.standUp._findStartedAreaAsync(player.tableId);

    if (!area || area.length == 0) {
        return {error: C.FISH_AREA_HAS_COMPLETED};
    }
    area = area[0];

    let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
    let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: area._id, playerId: player._id});

    if (!areaPlayer) {
        return {error: C.PLAYER_NOT_PLAYING}
    }

    if (lock) {
        areaPlayer.lockTargetId = area.biggestFish.id;
    } else {
        areaPlayer.lockTargetId = 0;
    }

    yield areaPlayer.saveAsync();

    if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
        logger.error(`[fishHunterGame][onLockTargetAsync] no betSetting! playerId: ${areaPlayer.playerId}`);
        return {error: C.ERROR};
    }
    return {error: null, data: {areaPlayer: areaPlayer.toClientData(betSetting)}};
});

proto.randomFishesDie = function (hitresult, score, tableLevel, bulletCost, gameId, fishType, fishState, player, debugData, forceLevel, unSubuki) {
    try {
        let die = false;
        let killFirst = debugData.killFirst;
        let noDieFirst = debugData.noDieFirst;

        //讀取FishAlgorithm.json
        let algConfig = this.app.controllers.fishHunterConfig.getFishAlgConfig(gameId);
        algConfig = algConfig[fishType];

        if (!!algConfig) {
            let check = this.getCheck(gameId, tableLevel);
            let levels = this.getLevel(check, gameId, tableLevel, forceLevel, player);
            algConfig = algConfig[levels];

            let randomConfig = utils.randProbability.getRand(algConfig, 'rtpprob', m_objRNGMethod);
            if (!!randomConfig) {

                switch (fishState) {
                    case consts.FishState.CHAIN:
                    case consts.FishState.FLASH:
                    case consts.FishState.METEOR:
                    case consts.FishState.FLASH_SHARK:
                    case consts.FishState.WAKEN:
                        die = this.app.controllers.fishHunterAlg.getBombChainResult(hitresult);
                        break;
                    default:
                        die = this.app.controllers.fishHunterAlg.getRandomResult(randomConfig.rtpvales);
                        // die = true;
                        break;
                }
            }

            // if (!die && killFirst) die = killFirst;
            if (killFirst) {
                die = true;
            } else if (noDieFirst) {
                die = false;
            }

            // 風控檢查(RTP上限)
            return this.app.controllers.subuki.checkSUBUKI_MaxRTP(unSubuki, die, player, randomConfig, check, score, bulletCost, debugData);
        }

        // 沒有Config就用倍數去處理機率，但理論上不應該跑到
        logger.error("randomFishesDie can not find AlgConfig!!! tableLevel: %s, fishType: %s ", tableLevel, fishType);
        algConfig = this.app.controllers.fishHunterConfig.getCostAlgConfig(gameId);
        if (algConfig.args[tableLevel][bulletCost]) {
            algConfig = algConfig.args[tableLevel][bulletCost];
        } else {
            algConfig = algConfig.args[tableLevel][0];
        }
        die = this.app.controllers.fishHunterAlg.randomFishesDie(score, algConfig, null);
        return {randomConfig: randomConfig, die: die};
    } catch (err) {
        logger.error('[fishHunterGame][randomFishesDie] err: ', err);
    }
};

proto.getCheck = function (gameId, tableLevel) {
    try {
        let cache = this.app.controllers.fishHunterCache;
        let check = cache.getFishRTP(gameId, tableLevel);
        if (!check) {
            check = cache.getFishRTP(gameId);
        }
        return check;
    } catch (err) {
        logger.error('[fishHunterGame][getCheck] err: ', err);
        return null;
    }
}

proto.getLevel = function (check, gameId, tableLevel, forceLevel, player) {
    try {
        let levels = null;
        let cache = this.app.controllers.fishHunterCache;

        if (!forceLevel) {
            levels = _.cloneDeep(cache.getFishAlgArgs(player, tableLevel));
            // if (!levels) levels = cache.getFishAlgArgs(gameId);
            if (!levels) levels = 'normal';
        } else {
            levels = forceLevel;
        }
        return levels;
    } catch (err) {
        logger.error('[fishHunterGame][getLevel] err: ', err);
        return 'normal';
    }
}

// proto.removeAreaFish = cort(function*(areaId, fishId) {
//   let temp = yield this.app.models.FishHunterAreaFishes.findByIdAsync(areaId + fishId);
//   if (!!temp) {
//     yield temp.removeAsync();
//   }
//
//   return temp;
// });

proto._onCollectGameTokensByArea = cort(function* (areaId) {
    let self = this;
    let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
    let areaPlayers = yield modelAreaPlayers.findReadOnlyAsync({areaId: areaId});

    for (let i = 0; i < areaPlayers.length; i++) {
        self.collectGameTokens(areaPlayers[i].playerId, areaId);
    }
});

proto.collectGameTokens = function (playerId, areaId) {
    let self = this;
    let modelVoucher = this.app.models.GameTokensVoucher;
    let lastFireTime = 0;
    let gain = 0;
    let cost = 0;
    let gameId = 0;
    let vIds = [];

    return P.resolve(0)
        .then(() => {
            return self.app.memdb.goose.transactionAsync(cort(function* () {
                let key = self.tokensVoucher.makeKey(areaId, playerId)
                vIds = self.tokensVoucher.getIds(key);

                if (vIds.length == 0) {
                    return null;
                }

                self.tokensVoucher.remove(key);
                //logger.warn('collect voucher ', playerId, ' count ', vIds.length, ' Ids ', util.inspect(vIds));

                let vouchers = [];
                for (let i = 0; i < vIds.length; i++) {
                    let v = yield modelVoucher.findByIdAsync(vIds[i]);
                    // let v = yield modelVoucher.findByIdReadOnlyAsync(vIds[i]);
                    if (!!v) {
                        vouchers.push(v);
                    } else {
                        //  logger.error(' game voucher not found ', vIds[i]);
                    }
                }

                let data = null;
                if (!!vouchers && vouchers.length > 0) {
                    gameId = vouchers[0].gameId;

                    vouchers.forEach((value) => {
                        if (value.amount < 0) {

                            if (lastFireTime < value.createTime) {
                                lastFireTime = value.createTime;
                            }
                            cost = utils.number.add(cost, value.amount);
                        } else {
                            gain = utils.number.add(gain, value.amount);
                        }
                    });

                    for (let i = 0; i < vouchers.length; i++) {
                        yield vouchers[i].removeAsync();
                    }

                    data = {cost: cost, gain: gain, lastFireTime: lastFireTime, gameId: gameId};
                }

                return data;
            }), self.app.getServerId());
        })
        .then((data) => {
            if (!!data) {
                return self.app.memdb.goose.transactionAsync(function () {
                    let playerControl = self.app.controllers.fishHunterPlayer;
                    return playerControl.findReadOnlyAsync(playerId);
                }, self.app.getServerId())
                    .then(p => {
                        if (!!p) {
                            data.gameServerId = p.gameServerId;
                        }

                        return data;
                    })
            } else {
                return data;
            }
        })
        .then((data) => {
            if (!!data) {
                let shardId = data.gameServerId || self.app.getServerId();
                return self.app.memdb.goose.transactionAsync(cort(function* () {
                    let delta = utils.number.add(cost, gain);
                    let balance = yield self.app.controllers.fishHunterPlayer.updateWalletBalance(playerId, gameId, delta, 'collect');
                    yield self._onUpdateAreaPlayer({playerId: playerId, areaId: areaId}, {
                        lastFireTime: lastFireTime,
                        gain: gain,
                        cost: Math.abs(cost)
                    });

                    if (!!balance) {
                        logger.warn('update balance ', playerId, ' amount ', balance.amount);
                        self.app.controllers.fishHunterPlayer.pushAsync(playerId, consts.route.client.game.UPDATE_BALANCE, {
                            pid: playerId,
                            balance: balance.amount
                        }, false);
                    }
                }), shardId);
            }
        })
        .catch((err) => {
            logger.error('collect game voucher ', err, ' vids ', vIds);
        })
};

proto._removeTokenVouchers = function (ids) {
    let self = this;
    let modelVoucher = this.app.models.GameTokensVoucher;

    if (ids.length === 0) {
        return;
    }

    return self.transactionAsync(cort(function* () {
        for (let i = 0; i < ids.length; i++) {
            let v = yield modelVoucher.findByIdAsync(ids[i]);
            if (!!v) {
                yield v.removeAsync();
            }
        }
    }));
};
///////////////////// Cron End //////////////////////////////


proto.pushTableMsg = async function (
    player,
    tableId,
    route,
    allPlayers
) {
    try {

        const schemaTable = this.app.models['Table'];
        const schemaGameTokens = this.app.models['GameTokens'];
        const schemaPlayer = this.app.models['FishHunterPlayer'];

        // let table = _.isString(tableId) ? yield this.app.controllers.table.findReadOnlyAsync(tableId) : tableId;
        const table = _.isString(tableId)
            ? await this.mona.get({
                schema: schemaTable,
                id: tableId,
            })
            : tableId;


        const pushPlayerIds = table.playerIds.filter((p) => {
            return !!p && p !== player._id;
        });

        // let wallet = yield this.app.controllers.fishHunterPlayer.findWalletReadOnlyAsync(player._id, player.gameId);

        const wallet = await this.mona.findOne({
            schema: schemaGameTokens,
            query: {
                playerId: player._id,
                gameId: player.gameId,
            }
        });


        let pData = player.toClientData();
        if (!!wallet) {
            pData.gold = wallet.amount;
        }
        let players = [pData];


        if (allPlayers) {
            for (let i = 0; i < pushPlayerIds.length; i++) {

                const p = await this.mona.get({
                    schema: schemaPlayer,
                    id: pushPlayerIds[i],
                });

                const w = await this.mona.findOne({
                    schema: schemaGameTokens,
                    query: {
                        playerId: p._id,
                        gameId: p.gameId,
                    }
                })

                // let p = yield this.app.controllers.fishHunterPlayer.findReadOnlyAsync(pushPlayerIds[i]);
                // let w = yield this.app.controllers.fishHunterPlayer.findWalletReadOnlyAsync(p._id, p.gameId);

                const d = p.toClientData();
                if (!!w) {
                    d.gold = w.amount;
                }

                players.push(p.toClientData());
            }
        }

        if (pushPlayerIds.length > 0) {
            for (let i = 0; i < pushPlayerIds.length; i++) {
                this.app.controllers['fishHunterPlayer'].pushPlayerMsg(pushPlayerIds[i], route, {
                    table: table,
                    players: players
                }, false);
            }
        }

        return {table: table, players: players};
    } catch (err) {
        logger.error('[fishHunterGame][pushTableMsg] player: %s, err: ', JSON.stringify(player), err);
        throw err;
    }
};


proto.pushTableMsgAsync = cort(function* (player, tableId, route, allPlayers) {
    try {
        let table = _.isString(tableId) ? yield this.app.controllers.table.findReadOnlyAsync(tableId) : tableId;

        let pushPlayerIds = table.playerIds.filter((p) => !!p && p != player._id);

        let wallet = yield this.app.controllers.fishHunterPlayer.findWalletReadOnlyAsync(player._id, player.gameId);
        let pData = player.toClientData();
        if (!!wallet) {
            pData.gold = wallet.amount;
        }
        let players = [pData];

        if (allPlayers) {
            for (let i = 0; i < pushPlayerIds.length; i++) {
                let p = yield this.app.controllers.fishHunterPlayer.findReadOnlyAsync(pushPlayerIds[i]);
                let w = yield this.app.controllers.fishHunterPlayer.findWalletReadOnlyAsync(p._id, p.gameId);

                let d = p.toClientData();
                if (!!w) {
                    d.gold = w.amount;
                }
                players.push(p.toClientData());
            }
        }

        if (pushPlayerIds.length > 0) {
            for (let i = 0; i < pushPlayerIds.length; i++) {
                this.app.controllers.fishHunterPlayer.pushAsync(pushPlayerIds[i], route, {
                    table: table,
                    players: players
                }, false);
            }
        }

        return {table: table, players: players};
    } catch (err) {
        logger.error('[fishHunterGame][pushTableMsgAsync] player: %s, err: ', JSON.stringify(player), err);
    }
});
