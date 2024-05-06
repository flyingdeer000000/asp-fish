'use strict';
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../share/constant');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('connector', __filename);
let utils = require('../utils/utils');

let Controller = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

// 廣播(廣播種類, 處理資料)
proto.checkBroadcast = cort(function* (broadcastType, player, data) {
    try {
        if (!broadcastType || !_.isString(broadcastType) || broadcastType === '') return;
        let self = this;
        /* 處理完回傳的格式 */
        let result = {
            // msg: [],         // 廣播訊息
            // log: []          // 廣播Log
        };
        const paramDefinConf = self.app.controllers.fishHunterConfig.getParamDefinConfig(); // 取得參數設定檔
        if (!paramDefinConf) return;

        switch (broadcastType) {
            case consts.BroadcastType.HIGH_ODDS: // 檢查碰撞結果有無獲得高賠率
                result = yield self.checkHighOdds(data, player, paramDefinConf);
                break;
            case consts.BroadcastType.ACTIVITY: // 活動
                break;
            case consts.BroadcastType.JP: // JP
                break;
        }

        if (Object.keys(result).length > 0) {
            // 取得廣播發送對象設定檔
            const sendTarget = paramDefinConf.BroadcastSendTarget;
            if (!sendTarget || !sendTarget[broadcastType]) {
                logger.error('[broadcast.js][checkBroadcast] playerId: %s, BroadcastSendTarget config not fund: ', player._id, sendTarget, ' type:', broadcastType);
                return;
            }

            let sendPlayerIds = []; // 欲送訊息的玩家id列表
            /**
             * @param { Array } onlyPlayers:
             * [ { (玩家Id)wn6e3yV95Z361Pc7eZo2RJ: {
             connectorId: connectorId,
             gameState: 玩家狀態, gameId: 遊戲Id, loginIp: IP,
             isSingleWallet: 錢包類型,
             updateTime: 1623747660104,
             updateSingleWalletBalanceTime: 1623747651027,
             updateSingleBetAndWinDelayTime: 1623747651027,
             specialKeepAliveTime: 1623747651028,
             dc: dc, currency: 幣別 }
             } ]
             */
            let onlyPlayers = []; // 線上玩家資料列表
            let players = self.app.controllers.fishHunterCache.getOnlinePlayers(); // 該玩家所在的 fishHunter server
            if (players) {
                for (let id in players) {
                    onlyPlayers.push({
                        playerId: id,
                        gameId: players[id].gameId,
                        currency: players[id].currency,
                    });
                }
            }
            // 找其他 fishHunter server 的線上玩家
            let fishHunters = self.app.getServersByType('fishHunter'); // 取得所有 fishHunter server 列表
            let fishHunterRpc = self.app.rpc.fishHunter.areaRemote;
            for (let i = 0; i < fishHunters.length; i++) {
                // 過濾本身所在的 fishHunter server
                if (fishHunters[i].id === self.app.getServerId()) {
                    continue;
                }
                let rpc_players = yield P.promisify(fishHunterRpc.getOnlinePlayers.toServer, fishHunterRpc)(fishHunters[i].id);
                if (rpc_players) {
                    for (let id in rpc_players) {
                        onlyPlayers.push({
                            playerId: id,
                            gameId: rpc_players[id].gameId,
                            currency: rpc_players[id].currency,
                        });
                    }
                }
            }

            if (onlyPlayers.length > 0) {
                switch (sendTarget[broadcastType]) {
                    case consts.BroadcastSendTarget.ALL: // 全部
                        for (let item of onlyPlayers) {
                            sendPlayerIds.push(item.playerId);
                        }
                        break;
                    case consts.BroadcastSendTarget.CURRENCY: // 幣別
                        for (let item of onlyPlayers) {
                            if (item.currency === player.currency) sendPlayerIds.push(item.playerId);
                        }
                        break;
                    case consts.BroadcastSendTarget.GAMEID: // 遊戲ID: 只給該款遊戲的玩家 ex.10001/10002/10003
                        for (let item of onlyPlayers) {
                            if (item.gameId === player.gameId) sendPlayerIds.push(item.playerId);
                        }
                        break;
                    case consts.BroadcastSendTarget.GAMEID_CURRENCY: // 遊戲ID+幣別
                        for (let item of onlyPlayers) {
                            if (item.gameId === player.gameId && item.currency === player.currency) sendPlayerIds.push(item.playerId);
                        }
                        break;
                }
            }

            // ------- 取 memdb fishHunterPlayer ------------------------------
            // let sendPlayerIds = [];
            // yield self.app.memdb.goose.transactionAsync(cort(function* () {
            //     let playerList = [];
            //     // 廣播要傳送的對象
            //     switch (sendTarget[broadcastType]) {
            //         case consts.BroadcastSendTarget.ALL: // 全部
            //             let playerList_N = yield self.app.models.FishHunterPlayer.findReadOnlyAsync({ accountState: consts.AccountState.NORMAL }); // 一般玩家
            //             let playerList_F = yield self.app.models.FishHunterPlayer.findReadOnlyAsync({ accountState: consts.AccountState.FREEZE }); // 凍結玩家
            //             playerList = playerList_N.concat(playerList_F);
            //             break;
            //         case consts.BroadcastSendTarget.CURRENCY: // 幣別
            //             playerList = yield self.app.models.FishHunterPlayer.findReadOnlyAsync({ currency: player.currency });
            //             break;
            //         case consts.BroadcastSendTarget.GAMEID: // 遊戲ID: 只給該款遊戲的玩家 ex.10001/10002/10003
            //             playerList = yield self.app.models.FishHunterPlayer.findReadOnlyAsync({ gameId: player.gameId });
            //             break;
            //         case consts.BroadcastSendTarget.GAMEID_CURRENCY: // 遊戲ID+幣別
            //             playerList = yield self.app.models.FishHunterPlayer.findReadOnlyAsync({ currency: player.currency, gameId: player.gameId });
            //             break;
            //     }
            //     // 取出在線玩家ID
            //     playerList.map((player) => {
            //         if (!!player._id &&
            //             player._id != '' &&
            //             (player.gameState == consts.GameState.FREE || player.gameState == consts.GameState.PLAYING)
            //         ) {
            //             sendPlayerIds.push(player._id);
            //         }
            //     });
            // }), self.app.getServerId())
            // .catch((err) => {
            //     logger.error('[broadcast.js][checkBroadcast] playerId: %s, transactionAsync err: ', player._id, err);
            // });

            if (sendPlayerIds.length > 0) {
                self.app.controllers.debug.info('info', 'Broadcast: ' + broadcastType, {
                    time: Date.now(),
                    data: result.log
                });

                let playerName = '';
                for (let i in result.msg) {
                    playerName = result.msg[i].nickName;
                    let middleHideName = '';
                    for (let j = 2; j < playerName.length - 2; j++) {
                        middleHideName += '*';
                    }
                    result.msg[i].nickName = playerName.substr(0, 2) + middleHideName + playerName.substr(playerName.length - 2, 2);
                }
                self.app.controllers.fishHunterPlayer.pushAsync(sendPlayerIds, consts.route.client.game.BROADCAST, result.msg);
            }
        }
    } catch (err) {
        logger.error('[broadcast][checkBroadcast] playerId: %s, err: ', player._id, err);
    }
});

// 檢查是否有高賠率的碰撞
proto.checkHighOdds = cort(function* (colliderResult, player, paramDefinConf) {
    try {
        let self = this;
        // 取得共同設定檔: commonConf.json列表
        const commonConf = self.app.controllers.fishHunterConfig.getCommonConfig(player.gameId);
        // 取得fishHunter_tableLevel.json列表
        const fishHunterConf = self.app.controllers.fishHunterConfig.getGameConfig(player.gameId, player.tableLevel);
        // 設定擋不存在時回傳
        if (!commonConf || !fishHunterConf) return {};
        const highOddsConfig = commonConf.BroadcastHighOdds; // 廣播高賠率設定值
        const treasureList = fishHunterConf.treasureList; // 寶藏列表
        const weaponsList = paramDefinConf.weapon; // 特殊武器列表
        // 設定擋不存在時回傳
        if (!highOddsConfig || !treasureList || !weaponsList) return {};

        let highOddsData = [];
        let highOddsLog = [];

        for (let res of colliderResult) {
            let treasureLength = Object.keys(res.treasure).length; // treasure長度

            // 魚有死
            if (res.die) {
                if (res.state == consts.FishState.WAKEN) {
                    // 覺醒的魚 賠率要*extraChainOdds(額外覺醒賠率)
                    res.odds = utils.number.multiply(res.odds, res.extraChainOdds);
                }
                // 魚本身的賠率 >= 設定檔高賠率 ex.200
                if (res.odds >= highOddsConfig) {
                    /*======= to 廣播 ===========*/
                    let msg = {
                        type: consts.BroadcastType.HIGH_ODDS,
                        nickName: player.nickName,
                        tableLevel: player.tableLevel,
                        fishType: res.fishRealType,
                        odds: res.odds,
                        income: res.income
                    };
                    highOddsData.push(msg);
                    /*======= to Log ===========*/
                    let log = _.cloneDeep(msg);
                    log['cost'] = res.cost;
                    highOddsLog.push(log);
                }
                /**************************************************
                 * 該魚「不是」treasure類的
                 * 且額外觸發Bonus Game的賠率 >= 設定檔高賠率 ex.200
                 * ex.10002王者皇帝龍/10003霸王蚌
                 **************************************************/
                let isTreasure = treasureList.indexOf(res.fishRealType) !== -1 ? true : false; // 被打到的魚種類是否為treasure
                if (!isTreasure && treasureLength > 0) {
                    let bonusOdds = utils.number.divide(res.treasure.amount, res.cost); // Bonus Game的賠率
                    if (bonusOdds >= highOddsConfig) {
                        /*======= to 廣播 ===========*/
                        let msg = {
                            type: consts.BroadcastType.HIGH_ODDS,
                            nickName: player.nickName,
                            tableLevel: player.tableLevel,
                            fishType: res.treasure.type,
                            odds: bonusOdds,
                            income: res.treasure.amount
                        };
                        highOddsData.push(msg);
                        /*======= to Log ===========*/
                        let log = _.cloneDeep(msg);
                        log['cost'] = res.cost;
                        log['bonusType'] = res.treasure.type;
                        highOddsLog.push(log);
                    }
                }
            }
            // 魚沒死
            else {
                /**************************************************
                 * 該魚不是特殊武器(武器res.treasure沒有amount)
                 * 且額外觸發Bonus Game的賠率 >= 設定檔高賠率 ex.200
                 * ex.Fish_201(紅包)
                 **************************************************/
                let isWeapon = weaponsList.indexOf(res.fishRealType) !== -1 ? true : false; // 被打到的魚種類是否為特殊武器
                if (!isWeapon && treasureLength > 0) {
                    let bonusOdds = utils.number.divide(res.treasure.amount, res.cost); // Bonus Game的賠率
                    if (bonusOdds >= highOddsConfig) {
                        /*======= to 廣播 ===========*/
                        let msg = {
                            type: consts.BroadcastType.HIGH_ODDS,
                            nickName: player.nickName,
                            tableLevel: player.tableLevel,
                            fishType: res.treasure.type,
                            odds: bonusOdds,
                            income: res.treasure.amount
                        };
                        highOddsData.push(msg);
                        /*======= to Log ===========*/
                        let log = _.cloneDeep(msg);
                        log['cost'] = res.cost;
                        log['bonusType'] = res.treasure.type;
                        highOddsLog.push(log);
                    }
                }
            }
        }/*=for end=*/

        // 沒有獲得高賠率時回傳
        if (highOddsData.length === 0) return {};

        return {msg: highOddsData, log: highOddsLog};
    } catch (err) {
        logger.error('[collider][checkHighOdds] playerId: %s, err: ', player._id, err);
        return {};
    }
});
