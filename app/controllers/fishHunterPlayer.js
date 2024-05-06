'use strict';

let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
const uuid = require('uuid/v1');
let consts = require('../../share/consts')
let logger = quick.logger.getLogger('connector', __filename);
let utils = require('../utils/utils');
let C = require('../../share/constant');
const apiCode = require('../expressRouter/apiServerStatus');
let m_md5 = require('md5');
const Mona = require("../dao/mona");

let Controller = function (app) {
    this.app = app;
    this.webConnectorCls = this.app.get('WebConnectorCls');
    this.globalChannelService = app.get('globalChannelService');
    this.mona = new Mona({
        shardId: app.getServerId()
    });
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;

proto.authAsync = P.coroutine(function* (account) {
    let self = this;

    return new P(function (resolve, reject) {
        self.webConnectorCls.jwtVerifyToken(account.token, function (err, data) {

            if (!err && data && data.uid == account.playerId) {
                resolve(data);
            } else {
                resolve(null);
            }
        })
    })
});

proto.decodeTokenAsync = P.coroutine(function* (token) {

    let self = this;

    logger.info('decode token ', token);

    return new P(function (resolve, reject) {

        self.webConnectorCls.jwtVerifyToken(token, function (err, data) {
            logger.info("decodeToken ", err, ' data ', data);

            if (!err) {
                resolve(data);
            } else {
                resolve(null);
            }
        })
    })
});

proto.createAsync = P.coroutine(function* (accountInfo) {
    try {
        let models = this.app.models;
        let player = null;

        player = yield models.FishHunterPlayer.findByIdAsync(accountInfo.playerId);
        let oldRoundId = null;
        let oldGameId = null;

        // 檢查 api 傳來的錢包類型是否為 string && (多錢包 or 一般單錢包 or後扣型錢包)，需轉成 Number 型態，以防後續所有 switch case 判斷錯誤。
        if (typeof accountInfo.isSingleWallet == 'string' &&
            (accountInfo.isSingleWallet == consts.walletType.multipleWallet ||
                accountInfo.isSingleWallet == consts.walletType.singleWallet ||
                accountInfo.isSingleWallet == consts.walletType.singleBetAndWinDelay)
        ) {
            logger.info('[fishHunterPlayer][createAsync] playerId: %s, login api res isSingleWallet is string. accountInfo: %s ', accountInfo.playerId, JSON.stringify(accountInfo));
            accountInfo.isSingleWallet = _.toNumber(accountInfo.isSingleWallet);
        }

        if (!player) {
            //玩家未登入過，創mongo FishHunterPlayer
            player = new models.FishHunterPlayer({
                _id: accountInfo.playerId,
                createTime: utils.timeConvert(Date.now()),
                updateTime: utils.timeConvert(Date.now()),
                // gameServerId: '',
                // gameId:       '',
                // connectorId:  '',
                // tableId:      '',
                // tableLevel:   '',
                userName: accountInfo.userName,
                nickName: accountInfo.nickName,
                gameState: consts.GameState.FREE,
                // areaId:       '',
                loginIp: accountInfo.ip || '',
                clientType: accountInfo.clientType || '',
                // gold:         0,
                accountState: accountInfo.accountState || consts.AccountState.FREEZE,
                currency: accountInfo.creditCode || 'CNY',
                launchToken: accountInfo.token || '',
                isPromo: accountInfo.isPromo || false,
                dc: accountInfo.dc,
                platformPlayerId: accountInfo.platformPlayerId,
                isSingleWallet: accountInfo.isSingleWallet,
                roundID: accountInfo.roundID,
                wId: '',
                demo: accountInfo.isDemo,
                upid: accountInfo.UpId,
                hallId: accountInfo.HallId,
                mySQLWallet: accountInfo.MySQLWallet,
            });
        } else {
            //玩家登入過，更新資訊
            oldGameId = player.gameId;
            oldRoundId = player.roundID;

            // 檢查上一場是否結帳完成 // 只檢查多錢包，單錢包需後踢前完後檢查
            let gameSettlementDone = yield this.getGameSettlementState(player, oldGameId);
            if (!gameSettlementDone) {
                logger.info(`[fishHunterPlayer][createAsync][${accountInfo.roundID}] playerId: ${player._id}, oldRoundId: ${oldRoundId}, oldGameId: ${oldGameId}, backendServerId: ${player.backendServerId}, gameSettlementDone: ${gameSettlementDone}`);
                return {error: C.SETTLEMENT_STILL_ON_GOING}; // 上一場未結帳完成
            }

            player.roundID = accountInfo.roundID;
            player.wId = '';

            // createTime
            player.updateTime = utils.timeConvert(Date.now());
            // gameServerId
            // gameId
            // connectorId
            // tableId
            // tableLevel
            if (player.nickName != accountInfo.nickName) player.nickName = accountInfo.nickName;
            // if (player.gameState != consts.GameState.FREE)                player.gameState = consts.GameState.FREE;
            // areaId
            if (player.loginIp != accountInfo.ip) player.loginIp = accountInfo.ip;
            if (player.clientType != accountInfo.clientType) player.clientType = accountInfo.clientType;
            // gold
            if (player.accountState != accountInfo.accountState) player.accountState = accountInfo.accountState;
            if (player.currency != accountInfo.creditCode) player.currency = accountInfo.creditCode;
            if (player.launchToken != accountInfo.token) player.launchToken = accountInfo.token;
            if (player.isPromo != accountInfo.isPromo) player.isPromo = accountInfo.isPromo;
            if (player.dc != accountInfo.dc) player.dc = accountInfo.dc;
            if (player.platformPlayerId != accountInfo.platformPlayerId) player.platformPlayerId = accountInfo.platformPlayerId;
            if (player.isSingleWallet != accountInfo.isSingleWallet) player.isSingleWallet = accountInfo.isSingleWallet;
            if (player.demo !== accountInfo.isDemo) player.demo = accountInfo.isDemo;
            if (player.upid !== accountInfo.UpId) player.upid = accountInfo.UpId;
            if (player.hallId !== accountInfo.HallId) player.hallId = accountInfo.HallId;
            if (player.mySQLWallet !== accountInfo.MySQLWallet) player.mySQLWallet = accountInfo.MySQLWallet;
        }

        yield player.saveAsync();
        return {player, oldRoundId, oldGameId};
    } catch (err) {
        logger.error('[fishHunterPlayer][createAsync] accountInfo: %s, err : ', JSON.stringify(accountInfo), err);
    }
});

// proto.updateAsync = P.coroutine(function*(playerId, opts) {
//   let player = yield this.app.models.FishHunterPlayer.findByIdAsync(playerId);
//   if (!player) {
//     throw new Error('player ' + playerId + ' not exist');
//   }
//   this.app.models.FishHunterPlayer.getUpdatableKeys().forEach(function (key) {
//     if (opts.hasOwnProperty(key)) {
//       player[key] = opts[key];
//     }
//   });
//
//   player.updateTime = utils.timeConvert(Date.now());
//   yield player.saveAsync();
//
//   let loggerCtrl = this.app.controllers.sysLogger;
//   loggerCtrl.addLog(player._id, loggerCtrl.getEvent(this.app.models.FishHunterPlayer, 'u'), opts);
// });


proto.internalUpdate = async function (playerId, opts, validator) {

    let self = this;
    // TODO
    const schema = this.app.models['FishHunterPlayer'];
    const player = await this.mona.get({
        schema: schema,
        id: playerId,
    })

    // yield this.app.models.FishHunterPlayer.findByIdAsync(playerId);
    if (!player) {
        throw new Error('Player Not Found: ' + playerId);
    }

    if (!!validator && !validator(player)) {
        return null;
    }

    schema.getInternalUpdatableKeys().forEach(function (key) {
        if (opts.hasOwnProperty(key)) {
            player[key] = opts[key];
            if (key === 'gameState') {
                self.app.controllers.fishHunterCache.updatePlayerGameState(playerId, opts[key]);
            }
        }
    });

    player.updateTime = utils.timeConvert(Date.now());
    // TODO
    // yield player.saveAsync();
    await player.save();

    const loggerCtrl = this.app.controllers['sysLogger'];
    loggerCtrl.addLog(player._id, loggerCtrl.getEvent(schema, 'u'), opts);

    return player;

};

proto.internalUpdateAsync = P.coroutine(function* (playerId, opts, validator) {
    try {
        let self = this;
        let player = yield this.app.models.FishHunterPlayer.findByIdAsync(playerId);
        if (!player) {
            throw new Error('player ' + playerId + ' not exist');
        }

        if (!!validator && !validator(player)) {
            return null;
        }

        this.app.models.FishHunterPlayer.getInternalUpdatableKeys().forEach(function (key) {
            if (opts.hasOwnProperty(key)) {
                player[key] = opts[key];
                if (key === 'gameState') {
                    self.app.controllers.fishHunterCache.updatePlayerGameState(playerId, opts[key]);
                }
            }
        });

        player.updateTime = utils.timeConvert(Date.now());
        yield player.saveAsync();

        let loggerCtrl = this.app.controllers.sysLogger;
        loggerCtrl.addLog(player._id, loggerCtrl.getEvent(this.app.models.FishHunterPlayer, 'u'), opts);
        return player;
    } catch (err) {
        logger.error('[fishHunterPlayer][internalUpdateAsync] playerId: %s, err: ', playerId, err);
    }
});

// proto.removeAsync = P.coroutine(function*(playerId) {
//   let player = yield this.app.models.FishHunterPlayer.findByIdAsync(playerId);
//   if (!player) {
//     throw new Error('player ' + playerId + ' not exist');
//   }
//
//   let channelId = 'p:' + playerId;
//   // yield this.app.controllers.push.quitAsync(channelId, playerId);
//   yield player.removeAsync();
//
//   logger.info('removeAsync %s', playerId);
//
//   let loggerCtrl = this.app.controllers.sysLogger;
//   loggerCtrl.addLog(player._id, loggerCtrl.getEvent(this.app.models.FishHunterPlayer, 'd'), {
//     gold: player.gold,
//     nickname: player.nickName
//   });
// });

proto.findReadOnlyAsync = P.coroutine(function* (playerId) {
    try {
        let player = yield this.app.models.FishHunterPlayer.findByIdReadOnlyAsync(playerId);
        return player;
    } catch (err) {
        logger.error('[fishHunterPlayer][findReadOnlyAsync] playerId: %s, err : ', playerId, err);
    }
});

proto.findOneAsync = P.coroutine(function* (playerId) {
    try {
        let player = yield this.app.models.FishHunterPlayer.findByIdAsync(playerId);
        return player;
    } catch (err) {
        logger.error('[fishHunterPlayer][findOneAsync] playerId: %s, err: ', playerId, err);
    }
});

// 玩家登出遊戲或斷線，把剩餘遊戲代幣帶回customer
proto.walletToAccountAsync = P.coroutine(function* (player, reason, betSetting) {
    try {
        let self = this;
        let playerId = player._id;
        let gameId = player.gameId;
        let tokensDao = self.app.controllers.daoMgr.getGameTokenDao();
        // let tokens = yield self.app.models.GameTokens.findOneAsync({playerId, gameId});
        let tokens = yield tokensDao.settlePrepare(playerId, gameId);
        logger.info('[fishHunterPlayer][walletToAccountAsync] playerId: %s, roundId: %s, reason: %s, tokens: %s', playerId, player.roundID, reason, tokens);
        if (!tokens) return {error: C.ERROR, reason: 'Not find tokens: ' + tokens};
        let isLogout = true; // 現在是否為登出
        // 無 transferIn 紀錄，不需 transferOut
        if (reason == 'logout' && tokens.allAreaExchange == 0) {
            tokens = yield tokensDao.settleComplete(playerId, gameId, isLogout, true);
            return tokens.toClientData();
        }
        let accountCtrl = self.app.controllers.account;
        let credit = tokens.balance;
        let account;
        player['ratio'] = tokens.ratio;
        // 正式 or 測試帳號
        if (player.demo !== consts.demoType.demo) {
            // 總輸贏異常: 凍結
            let netWin = utils.number.sub(credit, tokens.allAreaExchange);
            if (tokens.realNetWin !== netWin) {
                let desc = `netWin Unusual , netWin = ${netWin}, Real token.realNetWin = ${tokens.realNetWin}`;
                self.app.controllers.debug.info('error', 'walletToAccountAsync', {
                    playerId: playerId,
                    userName: player.userName,
                    dc: player.dc,
                    totalExchange: tokens.allAreaExchange,
                    amount: tokens.balance,
                    where: reason,
                    reason: desc,
                });
                if (player.accountState === consts.AccountState.NORMAL) {
                    yield accountCtrl.modifyCustomerStateByCid(player, consts.AccountState.FREEZE, desc);
                    // 凍結後才把錢轉回 MySQL
                    yield accountCtrl.modifyCreditByPlayerIdAsync(player, credit, tokens.creditCode, reason, true, false);
                }
                logger.fatal('[緊急] 玩家轉出時總輸贏異常，已阻擋轉出並凍結玩家！ userName:%s, playerId:%s, dc:%s, desc:%s', player.userName, playerId, player.dc, desc);
                yield tokensDao.settleComplete(playerId, gameId, isLogout, true);
                return {error: C.ERROR, reason: consts.PlayerStateDesc.NetWinUnusual};
            }

            if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
                logger.error(`[fishHunterPlayer][walletToAccountAsync] no betSetting! playerId: ${player._id}`);
                yield tokensDao.settleComplete(playerId, gameId, isLogout, true);
                return {error: C.ERROR, reason: `No bet setting. playerId: ${player._id}`};
            }
            // let currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfigByDC(player.dc);
            // if (!currencyConfig) currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfig();
            // let exchangeRateLimit = currencyConfig[(tokens.creditCode?tokens.creditCode:'CNY')].exchangeRateLimit;
            let exchangeRateLimit = betSetting.exchangeLimit;
            // 洗分超過上限: 凍結
            if (netWin >= exchangeRateLimit) {
                let desc = `Exchange Rate Limit ${exchangeRateLimit}, Player netWin is ${netWin}`;
                self.app.controllers.debug.info('error', 'walletToAccountAsync', {
                    playerId: playerId,
                    userName: player.userName,
                    dc: player.dc,
                    totalExchange: tokens.allAreaExchange,
                    amount: tokens.balance,
                    where: reason,
                    reason: desc,
                });

                if (player.accountState === consts.AccountState.NORMAL) {
                    yield accountCtrl.modifyCustomerStateByCid(player, consts.AccountState.FREEZE, desc);
                    // 凍結後才把錢轉回 MySQL
                    yield accountCtrl.modifyCreditByPlayerIdAsync(player, credit, tokens.creditCode, reason, true, false);
                }
                logger.fatal('[緊急] 玩家轉出時額度超過幣別上限，已阻擋轉出並凍結玩家！ userName:%s, playerId:%s, dc:%s, desc:%s', player.userName, playerId, player.dc, desc);
                yield tokensDao.settleComplete(playerId, gameId, isLogout, true);
                return {error: C.ERROR, reason: consts.PlayerStateDesc.ExchangeRateLimit};
            }

            // 把錢轉回 MySQL
            account = yield accountCtrl.modifyCreditByPlayerIdAsync(player, credit, tokens.creditCode, reason, false, false);

        } else {
            let opts = {playerId, amount: credit, quota: tokens.quota};
            logger.warn('[fishHunterPlayer][walletToAccountAsync] getOneModifyCreditByPlayerIdRes ：', opts);
            account = yield self.app.controllers.accountDemo.getOneModifyCreditByPlayerIdRes(opts);
            logger.warn('[fishHunterPlayer][walletToAccountAsync][getOneModifyCreditByPlayerIdRes] apiData：', account);
        }

        if (!account || account.error) {
            yield tokensDao.settleComplete(playerId, gameId, isLogout, true);
            return {error: account.error, msg: 'modifyCreditByPlayerIdAsync Fail. error: ' + account.error};
        }

        let accountInfo = account.data;
        if (tokens.creditCode != accountInfo.creditCode) {
            self.app.controllers.debug.info('error', 'walletToAccountAsync', {
                playerId: playerId,
                gameId: gameId,
                amount: tokens.balance,
                tokens_creditCode: tokens.creditCode,
                account_creditCode: accountInfo.creditCode,
                logQuotaId: accountInfo.logQuotaId,
                reason: 'tokens.creditCode != accountInfo.creditCode',
            });
            yield tokensDao.settleComplete(playerId, gameId, isLogout, true);
            return {error: C.FAILD};
        }

        // 玩家 遊戲代幣creditCode與玩家帳號creditCode 相同時才洗分回去
        let oldAmount = tokens.tokenAmount; // 遊戲代幣 餘額

        // tokens.amount = utils.number.sub(tokens.amount, Math.abs(amount));
        // tokens.oneAreaExchange = tokens.amount;  // 原先帶入的金額
        // tokens.quota = 0;
        //等待API Server回傳結果驗證
        let config = this.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;

        let opts = {
            method: consts.APIMethod.transferOut,
            platform: consts.APIServerPlatform.api,
            dc: player.dc,
            upid: player.upid,
            playerId: playerId,
            launchToken: player.launchToken,
            amount: accountInfo.amount,     // 轉出額度
            deviceId: player.clientType,
            betGold: tokens.betGold,            // 總下注
            winGold: tokens.winGold,            // 總贏得
            roundID: player.roundID,         // 場次編號
            dsUseDc: player.dsUseDc,         // 域名設定使用的dc

            // 遊戲交易記錄用
            gameId: gameId,
            ratio: tokens.ratio,
            creditCode: tokens.creditCode,
            balance_before: accountInfo.balance_before,
            balance_after: accountInfo.balance_after,
            IP: player.loginIp,
            userName: player.userName,
            logQuotaId: accountInfo.logQuotaId,
        };
        logger.info('[fishHunterPlayer][walletToAccountAsync][CallAPI] transferOut ：', opts);

        let apiData;
        if (player.demo !== consts.demoType.demo) {
            // 正式or測試帳號
            apiData = yield utils.httpPost(url, opts);
        } else {
            logger.warn('[fishHunterPlayer][walletToAccountAsync] getOneTransferOutRes');
            apiData = self.app.controllers.accountDemo.getOneTransferOutRes(opts);
            logger.warn('[fishHunterPlayer][walletToAccountAsync][getOneTransferOutRes] apiData：', apiData);
        }

        if (!!apiData && apiData.status == apiCode.SUCCESS) {
            logger.info('[fishHunterPlayer][walletToAccountAsync][RES] playerId: %s, transferOut : ', playerId, apiData);
        } else {
            logger.error('[fishHunterPlayer][walletToAccountAsync][RES] playerId: %s, transferOut failed ：', playerId, JSON.stringify(apiData));
        }
        // tokens.betGold = 0;
        // tokens.winGold = 0;
        // tokens.updateTime = utils.timeConvert(Date.now());
        // yield tokens.saveAsync();
        tokens = yield tokensDao.settleComplete(playerId, gameId, isLogout, true);

        self.app.controllers.debug.info('info', 'walletToAccountAsync', {
            playerId: playerId,
            GameTokenRatio: tokens.ratio,
            amount: tokens.balance,
            gameId: tokens.gameId,
            creditCode: tokens.creditCode,
            amount_before: oldAmount,
            amount_after: tokens.tokenAmount,
            reason: reason,
            credit: credit,
            transactionId: (apiData) ? apiData.data.transactionId : "",
            roundID: player.roundID
        });

        let ret = tokens.toClientData();
        // 離開遊戲後，給前端顯示大廳左下角 玩家剩餘金額
        ret.creditAmount = apiData.data.balance || accountInfo.creditAmount; // transferOut 有回傳餘額，就用 transferOut 回傳的
        ret.roundID = player.roundID; // 回傳 roundId 讓 log 印
        return ret;

        /*
        tokens.netWin = 0;          // 總輸贏歸零
        tokens.allAreaExchange = 0; // 總兌換歸零
        tokens.oneAreaExchange = 0; // 單場兌換歸零
        tokens.quota = 0;           // SQL餘額值歸零
        tokens.winGold = 0;         // 總下注歸零
        tokens.betGold = 0;         // 總贏分歸零
        yield tokens.saveAsync();
        */

    } catch (err) {
        let logWarn = false;
        if (!!err.error && typeof err.error == 'object') {
            let msg = _.toString(err.error);
            if (msg.indexOf('socket hang up') > -1) logWarn = true;
        }
        if (logWarn) {
            logger.warn(`[fishHunterPlayer][walletToAccountAsync] playerId: ${player._id}, reason: ${reason}, player: ${JSON.stringify(player)}, err:`, err);
        } else {
            logger.error(`[fishHunterPlayer][walletToAccountAsync] playerId: ${player._id}, reason: ${reason}, player: ${JSON.stringify(player)}, err:`, err);
        }
    }
});

proto.accountToWalletAsync = P.coroutine(function* (player, amount, ratio, reason, allIn, fireServerId) {
    try {
        let self = this;
        switch (player.accountState) {
            case consts.AccountState.SUSPEND:
                self.app.controllers.debug.info('warn', 'accountToWalletAsync', {
                    playerId: player._id,
                    userName: player.nickName,
                    reason: '拒絕轉帳: 玩家帳號被停用, AccountState: ' + player.accountState,
                });
                return {code: C.PLAYER_STATE_SUSPEND, reason: 'Account state is suspend'};
            case consts.AccountState.FREEZE:
                self.app.controllers.debug.info('warn', 'accountToWalletAsync', {
                    playerId: player._id,
                    userName: player.nickName,
                    reason: '拒絕轉帳: 玩家帳號被凍結, AccountState: ' + player.accountState,
                });
                return {code: C.PLAYER_STATE_FREEZE, reason: 'Account state is freeze'};
        }

        if (ratio == 0) return {code: C.ERROR, reason: 'ratio = 0, ratio: ' + ratio};

        let tokensDao = self.app.controllers.daoMgr.getGameTokenDao();
        let detail = {};
        let playerId = player._id;
        let gameId = player.gameId;
        let tokens = yield tokensDao.findOneAsync(playerId, gameId, true);
        logger.info('[fishHunterPlayer][accountToWalletAsync] playerId: %s, tokens: %s', playerId, tokens);
        if (!tokens) return {code: C.ERROR, reason: 'token not exist: ' + tokens};

        //等待API Server回傳結果驗證
        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.APIMethod.transferIn,
            platform: consts.APIServerPlatform.api,
            upid: player.upid,
            dc: player.dc,
            playerId: playerId,
            launchToken: player.launchToken,
            amount: amount,
            deviceId: player.clientType,
            allIn: allIn,
            roundID: player.roundID,
            ggId: 1,
            dsUseDc: player.dsUseDc,

            //寫轉入log用
            gameId: gameId,
            ratio: tokens.ratio,
            creditCode: tokens.creditCode,
            IP: player.loginIp,
            userName: player.userName,
        };
        logger.warn('[fishHunterPlayer][accountToWalletAsync][CallAPI] transferIn ：', opts);
        // let apiData = yield utils.httpPost(url, opts);

        let apiData;
        if (player.demo !== consts.demoType.demo) {
            // 正式or測試帳號
            apiData = yield utils.httpPost(url, opts);
        } else {
            logger.warn('[fishHunterPlayer][accountToWalletAsync] getOneTransferInRes');
            if (allIn) amount = tokens.quota;
            opts.amount = utils.number.sub(tokens.quota, Math.abs(amount));
            apiData = self.app.controllers.accountDemo.getOneTransferInRes(opts);
            logger.warn('[fishHunterPlayer][accountToWalletAsync][getOneTransferInRes] apiData：', apiData);
        }

        if (!!apiData && apiData.status == apiCode.SUCCESS) {
            if (apiData.data.hasOwnProperty('status') && apiData.data.status !== apiCode.SUCCESS) {
                // call API 失敗
                switch (apiData.data.status) {
                    case C.CREDIT_QUOTA_NOT_ENOUGH: // 信用額度不足
                        self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.INSUFFICIENT_CREDIT_LIMIT);
                        return {code: C.INSUFFICIENT_CREDIT_LIMIT, reason: 'Insufficient credit limit.'};
                    case apiCode.PLAYER_OUT_GOLD: // 餘額不足
                        return {code: C.API_AUTH_FAIL, reason: 'Balance Insufficient.'};
                    default:
                        logger.warn('[fishHunterPlayer][accountToWalletAsync][RES] playerId: %s, API transferIn failed ：', playerId, JSON.stringify(apiData));
                        return {code: C.API_AUTH_FAIL, reason: 'API transferIn FAIL'};
                }

            }
            // call API 成功
            logger.info('[fishHunterPlayer][accountToWalletAsync][RES] playerId: %s, transferIn :', playerId, apiData);
        } else {
            // call webconnector 失敗
            logger.error('[fishHunterPlayer][accountToWalletAsync][RES] playerId: %s, webconnector transferIn failed ：', playerId, JSON.stringify(apiData));
            return {code: C.API_AUTH_FAIL, reason: 'API transferIn FAIL'};
        }

        // allIn = true 把MySQL.Quota全數帶出到tokens.amount遊戲代幣； false則只帶出amount的額度
        // let account = yield self.app.controllers.account.modifyCreditByPlayerIdAsync(playerId, -Math.abs(amount), tokens.creditCode, reason, allIn);
        let account;
        if (player.demo !== consts.demoType.demo) {
            // 正式or測試帳號
            account = yield self.app.controllers.account.modifyCreditByPlayerIdAsync(player, -Math.abs(amount), tokens.creditCode, reason, false, allIn, apiData.data.logQuotaId);
        } else {
            let opts = {playerId, amount: -Math.abs(amount), quota: tokens.quota};
            logger.warn('[fishHunterPlayer][walletToAccountAsync] getOneModifyCreditByPlayerIdRes ：', opts);
            account = yield self.app.controllers.accountDemo.getOneModifyCreditByPlayerIdRes(opts);
            logger.warn('[fishHunterPlayer][walletToAccountAsync][getOneModifyCreditByPlayerIdRes] apiData：', account);
        }

        if (!account || account.error) return {code: C.ERROR, reason: 'MySQL modify Credit FAIL'};
        let accountInfo = account.data;

        if (tokens.balance > 0 && tokens.ratio != ratio) {
            detail.remainAmount = tokens.tokenAmount;
            detail.remainRatio = tokens.ratio;
        }
        detail.oldAmount = tokens.tokenAmount;

        // 把從Quota的金額換算比例
        let delta = accountInfo.amount;//utils.number.divide(Math.abs(accountInfo.amount), ratio);

        // 玩家在遊戲房，須更新memWallet
        // if (player.gameState == consts.GameState.PLAYING) {
        //   // 不同台，得rpc去更新
        //   let rpc = self.app.rpc.fishHunterBackend.areaRemote;
        //   if (!!fireServerId) {
        //     rpc.doExchange.toServer(fireServerId, playerId, gameId, delta, (err, res) => {
        //       if (!err && !!res && !res.error)
        //         logger.debug('[rpc.doExchange] ',res);
        //       else
        //         logger.error('[rpc.doExchange] err by playerId = %s, gameId = %s, data = %s', playerId, gameId, data);
        //     });
        //   }
        // }

        tokens = yield tokensDao.exchangeAsync(player, delta, ratio, accountInfo.creditAmount, accountInfo.creditCode);
        if (!tokens) {
            logger.warn('[fishHunterPlayer][accountToWalletAsync][tokensDao.exchangeAsync] tokens is %s, playerId: %s, gameId: %s, amount: %s, allIn: %s, reason: %s', tokens, player._id, gameId, amount, allIn, reason);
            return {
                code: C.ERROR,
                reason: 'tokensDao.exchangeAsync fail',
                return_mysql: true,
                logQuotaId: apiData.data.logQuotaId,
                amount: delta
            };
        } else {
            self.app.controllers.debug.info('info', 'accountToWalletAsync', {
                playerId: player._id,
                ratio: tokens.ratio,
                amount: tokens.amount,
                delta: delta,
                gameId: tokens.gameId,
                creditCode: tokens.creditCode,
                amount_before: detail.oldAmount,
                tokens_quota: tokens.quota,
                MySQL_Quota: accountInfo.creditAmount,
                transactionId: apiData.data.transactionId,
                reason: reason
            });
        }

        let data = {};
        data.creditAmount = apiData.data.balance; //可用餘額
        data.amount = tokens.tokenAmount;         //可用分數
        data.ratio = ratio;

        return {code: null, data};
    } catch (err) {
        let logWarn = false;
        if (!!err.error && typeof err.error == 'object') {
            let msg = _.toString(err.error);
            if (msg.indexOf('socket hang up') > -1) logWarn = true;
        }
        if (logWarn) {
            logger.warn(`[fishHunterPlayer][accountToWalletAsync] playerId: ${player._id}, amount: ${amount}, ratio: ${ratio}, reason: ${reason}, allIn: ${allIn}, player: ${JSON.stringify(player)}, err:`, err);
        } else {
            logger.error(`[fishHunterPlayer][accountToWalletAsync] playerId: ${player._id}, amount: ${amount}, ratio: ${ratio}, reason: ${reason}, allIn: ${allIn}, player: ${JSON.stringify(player)}, err:`, err);
        }
        return {code: C.ERROR, reason: 'fail'};
    }
})

proto.createWalletAsync = P.coroutine(function* (accountInfo, gameId, player) {
    logger.debug('createWalletAsync ', accountInfo, ' gameId:', gameId, ' playerId:', player._id);

    try {
        let tokenDao = this.app.controllers.daoMgr.getGameTokenDao();
        let amount = 0;
        let quota = 0;

        switch (accountInfo.isSingleWallet) {
            // 單錢包
            case consts.walletType.singleBetAndWinDelay:
            case consts.walletType.singleWallet:
            case consts.walletType.singleBetAndWin:
                // 錢包在MySQL的用 creditAmount，其他平台用 balance
                quota = accountInfo.MySQLWallet ? accountInfo.creditAmount : accountInfo.balance;
                break;
            // 多錢包
            case consts.walletType.multipleWallet:
            // 假‧多錢包 or betAndWin
            default:
                // 其他平台帳號: MySQL 卡錢時, 將錢轉到 tokens.amount
                if (accountInfo.isSingleWallet == consts.walletType.multipleWallet) {
                    quota = accountInfo.creditAmount; // 玩家MySQL的餘額暫存tokens
                } else {
                    quota = accountInfo.MySQLWallet ? accountInfo.creditAmount : accountInfo.balance;
                }

                break;
        }

        return P.resolve()
            .then(() => {
                return tokenDao.initAsync(player._id, gameId, accountInfo.isSingleWallet, accountInfo.creditCode, quota, accountInfo.gameTypeId);
            })
            .then(data => {
                return data.toClientData();
            })

        // return tokens.toClientData();
    } catch (err) {
        logger.error('[fishHunterPlayer][createWalletAsync] accountInfo: %s, err: ', JSON.stringify(accountInfo), err);
    }
});

proto.updateWalletBalance = P.coroutine(function* (playerId, gameId, amount, reason) {
    logger.error('************updateWalletBalance unimplemented************************');
    // let loggerCtrl = this.app.controllers.sysLogger;
    // let modelTokens = this.app.models.GameTokens;
    // let tokens = yield modelTokens.findOneAsync({playerId: playerId, gameId: gameId});
    // if (!!tokens) {
    //   let oldAmount = tokens.amount;
    //   tokens.netWin = utils.number.add(tokens.netWin, amount);
    //   tokens.amount = utils.number.add(tokens.amount, amount);
    //
    //   yield tokens.saveAsync();
    //   loggerCtrl.addLog(tokens._id, loggerCtrl.getEvent(modelTokens, 'u'), {
    //     oldAmount: oldAmount,
    //     newAmount: tokens.amount,
    //     reason: reason
    //   });
    //
    //   return tokens;
    // }
    // else {
    //   logger.error('updateWalletBalance error ', playerId, ' amount ', amount);
    //
    //   return null;
    // }
});

proto.findWalletReadOnlyAsync = P.coroutine(function* (playerId, gameId) {
    try {
        if (!gameId || gameId == '') {
            return null;
        }
        let tokensDao = this.app.controllers.daoMgr.getGameTokenDao();
        return tokensDao.findOneAsync(playerId, gameId, true);
    } catch (err) {
        logger.error('[fishHunterPlayer][findWalletReadOnlyAsync] playerId: %s, gameId: %s, err: ', playerId, gameId, err);
    }
});

// proto.findWalletAsync = P.coroutine(function*(playerId, gameId) {
//
//   if (!gameId || gameId == '') {
//     return null;
//   }
//   let modelTokens = this.app.models.GameTokens;
//
//   let tokens = yield modelTokens.findOneAsync({playerId: playerId, gameId: gameId});
//   return tokens;
// });

proto.connectAsync = P.coroutine(function* (playerId, connectorId, gameId, accountState) {
    try {
        let oldConnectorId = null;
        let player = yield this.app.models.FishHunterPlayer.findByIdAsync(playerId);
        if (!player) {
            throw new Error('player ' + playerId + ' not exist');
        }
        oldConnectorId = player.connectorId;
        let oldGameServerId = player.gameServerId;
        if (player.accountState != accountState) {
            player.accountState = accountState;
        }
        player.connectorId = connectorId;
        player.gameId = gameId;
        player.gameServerId = this.app.getServerId();
        player.gameState = consts.GameState.FREE;
        player.updateTime = utils.timeConvert(Date.now());
        yield player.saveAsync();
        let channelId = null; //'p:' + playerId;
        this.globalChannelService.add(playerId, connectorId, channelId);
        this.app.controllers.debug.info('info', 'connectAsync', {playerId, connectorId, oldConnectorId});

        return {
            oldConnectorId: oldConnectorId,
            oldGameServerId: oldGameServerId,
            data: {player: player.toClientData()}
        };
    } catch (err) {
        logger.error('[fishHunterPlayer][connectAsync] playerId: %s, connectorId: %s, gameId: %s, err: ', playerId, connectorId, gameId, err);
    }
});

proto.offlineAsync = P.coroutine(function* (playerId) {
    try {
        let player = yield this.app.models.FishHunterPlayer.findByIdAsync(playerId);
        if (!player) {
            throw new Error('player ' + playerId + ' not exist');
        }

        player.connectorId = '';
        // player.gameId = '';
        player.gameServerId = '';
        // player.gameState = consts.GameState.LOGOUT; //修改玩家狀態:已登出

        player.updateTime = utils.timeConvert(Date.now());
        yield player.saveAsync();

        let loggerCtrl = this.app.controllers.sysLogger;
        loggerCtrl.addLog(player._id, loggerCtrl.getEvent(this.app.models.FishHunterPlayer, 'u'), {
            gold: player.gold,
            action: 'offline'
        });
        return player;
    } catch (err) {
        logger.error('[fishHunterPlayer][offlineAsync] playerId: %s, err: ', playerId, err);
    }
});

proto.disconnectAsync = P.coroutine(function* (playerId, connectorId) {
    try {
        // yield this.app.controllers.push.disconnectAsync(playerId);
        let channelId = null; //'p:' + playerId;
        this.globalChannelService.leave(playerId, connectorId, channelId);
    } catch (err) {
        logger.error('[fishHunterPlayer][disconnectAsync] playerId: %s, connectorId: %s, err: ', playerId, connectorId, err);
    }
});

proto.pushPlayerMsg = async function (playerId, route, msg, persistent) {
    try {
        // let channelId = 'p:' + playerId;
        let target = _.isArray(playerId) ? playerId : [playerId];
        this.app.controllers.debug.serverpush(
            route,
            JSON.stringify({msg: msg}),
            playerId
        );
        const content = { msg: msg };
        logger.info("[fishHunterPlayer][pushPlayerMsg]", target, route, content);
        return this.globalChannelService.pushMessageByUidArr(target, route, content);
        // yield this.app.controllers.push.pushAsync(channelId, null, route, msg, persistent);
    } catch (err) {
        logger.error('[fishHunterPlayer][pushPlayerMsg] playerId: %s, route: %s, err: ', playerId, route, err);
        throw err;
    }
};


proto.pushAsync = P.coroutine(function* (playerId, route, msg, persistent) {
    try {
        // let channelId = 'p:' + playerId;
        let target = _.isArray(playerId) ? playerId : [playerId];
        this.app.controllers.debug.serverpush(
            route,
            JSON.stringify({msg: msg}),
            playerId
        );
        const content = { msg: msg };
        logger.info("[fishHunterPlayer][pushAsync]", target, route, content);
        return this.globalChannelService.pushMessageByUidArr(target, route, content);
        // yield this.app.controllers.push.pushAsync(channelId, null, route, msg, persistent);
    } catch (err) {
        logger.error('[fishHunterPlayer][pushAsync] playerId: %s, route: %s, err: ', playerId, route, err);
    }
});

// proto.getMsgsAsync = P.coroutine(function*(playerId, seq, count){
//     let channelId = 'p:' + playerId;
//     return yield this.app.controllers.push.getMsgsAsync(channelId, seq, count);
// });

// 把玩家踢下線
proto.kickPlayer = P.coroutine(function* (connectorId, playerId, gameId, loginIp, updateTime, reason) {
    try {
        let self = this;
        let gameServerId = '';
        if (!connectorId) {
            let player = yield self.app.memdb.goose.transactionAsync(P.coroutine(function* () {
                // return self.app.models.FishHunterPlayer.findByIdAsync(playerId);
                return self.app.models.FishHunterPlayer.findByIdReadOnlyAsync(playerId);
            }), self.app.getServerId());

            connectorId = player.connectorId;
            gameServerId = player.gameServerId;
        }
        if (!connectorId) return;

        self.app.controllers.debug.info('warn', 'fishHunterPlayer.kickPlayer', {
            playerId: playerId,
            gameId: gameId,
            loginIp: loginIp,
            lastUpdateTime: updateTime,
            nowTime: new Date().toString(),
            reason: reason,
            gameServerId: gameServerId,
            connectorId: connectorId,
        });
        let entryRemote = self.app.rpc.connector.accountRemote;
        return P.promisify(entryRemote.kickSync, entryRemote)({frontendId: connectorId}, playerId, gameId, reason);
    } catch (err) {
        logger.error('[fishHunterPlayer][kickPlayer] playerId: %s, err: ', playerId, err);
    }
});

// 清除玩家token資料 for 單錢包
proto.clearTokensData = P.coroutine(function* (player) {

    let playerId = player._id;
    let gameId = player.gameId;
    // 後扣型錢包在 singleWalletBalanceSync 排程內處理
    if (player.isSingleWallet !== consts.walletType.singleBetAndWinDelay) {
        let tokensDao = this.app.controllers.daoMgr.getGameTokenDao();
        let tokens = yield tokensDao.settlePrepare(playerId, gameId);
        if (!tokens) return null;

        tokens = yield tokensDao.settleComplete(playerId, gameId, true, true);
        if (!!tokens) {
            return {error: null};
        } else {
            logger.error(`playerId:${playerId},gameId:${gameId} clearTokensData fail`);
            return {error: C.ERROR};
        }
    }
    return {error: null};

    // try {
    //   let playerId = player._id;
    //   let gameId = player.gameId;
    //   let tokens = yield this.app.models.GameTokens.findOneAsync({playerId, gameId});
    //   if (!tokens) return null;
    //   tokens.amount = 0;
    //   tokens.netWin = 0;
    //   tokens.oneAreaExchange = 0;
    //   tokens.allAreaExchange = 0;
    //   tokens.quota = 0;
    //   tokens.betGold = 0;
    //   tokens.winGold = 0;
    //
    //   yield tokens.saveAsync();
    //   return { error: null };
    // } catch (err) {
    //   logger.error('[fishHunterPlayer][clearTokensData] playerId: %s, err: ', playerId, err);
    // }
});

// 處理顯示給前端的餘額: updateBalance
proto.getCreditAmount = P.coroutine(function* (tokens, isSingleWallet) {
    try {
        let creditAmount = 0;
        switch (isSingleWallet) {
            case consts.walletType.multipleWallet:    // 多錢包
            case consts.walletType.singleWallet:      // 單錢包
            case consts.walletType.singleBetAndWin:   // 單錢包: betAndWin
            case consts.walletType.singleBetAndWinDelay: // 單錢包: delay
                creditAmount = tokens.amount;
                break;
            default: // 假多錢包 = 彈夾 + 餘額
                creditAmount = utils.number.add(tokens.amount, tokens.quota);
                break;
        }
        return creditAmount;
    } catch (err) {
        logger.error('[fishHunterPlayer][getCreditAmount] tokens: %s, isSingleWallet: %s, err: ', JSON.stringify(tokens), isSingleWallet, err);
    }
});


proto.callFetchBalanceEx = async function (player) {
    let self = this;
    const balanceRet = self.app.controllers['accountDemo'].getOnecallFetchBalanceRes();
    if (!!balanceRet && balanceRet.status !== apiCode.SUCCESS) {
        throw new Error("getOnecallFetchBalanceRes failure: " + JSON.stringify(balanceRet))
    }
    return {code: C.OK, amount: balanceRet.data.amount};
}

proto.callFetchBalance = P.coroutine(function* (player) {
    try {
        let self = this;
        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.APIMethod.fetchBalance,
            platform: consts.APIServerPlatform.api,
            dc: player.dc,
            // agentId:      session.get('agentId'),
            launchToken: player.launchToken,
            playerId: player._id,
            gameId: player.gameId,
            isSingleWallet: player.isSingleWallet,
            ggId: 1,
            dsUseDc: player.dsUseDc,
        };
        logger.info('[fishHunterPlayer][callFetchBalance][CallAPI] fetchBalance ：', opts);
        // let apiData = yield utils.httpPost(url, opts);

        let apiData;
        if (player.demo !== consts.demoType.demo) {
            // 正式or測試帳號
            apiData = yield utils.httpPost(url, opts);
        } else {
            logger.warn('[fishHunterPlayer][callFetchBalance] getOnecallFetchBalanceRes');
            apiData = self.app.controllers.accountDemo.getOnecallFetchBalanceRes();
            logger.warn('[fishHunterPlayer][callFetchBalance][getOnecallFetchBalanceRes] apiData：', apiData);
        }

        if (!!apiData && apiData.status == apiCode.SUCCESS) {

            if (!!apiData.data.status) {
                switch (apiData.data.status) {
                    case C.API_RETURN_TOKEN_EXPIRED: // token 過期
                    case C.CUSTOMER_IN_MAINTENANCE_MODE: // 介接方維護中
                        self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.API_AUTH_FAIL);
                        break;
                    default:
                        logger.error('[fishHunterPlayer][callFetchBalance][RES] playerId: %s, fetchBalance API failed ：', player._id, JSON.stringify(apiData));
                        break;
                }
                return {code: C.API_AUTH_FAIL, apiErrorCode: apiData.data.status};
            } else {
                logger.info('[fishHunterPlayer][callFetchBalance][RES] playerId: %s, fetchBalance : ', player._id, apiData);
                return {code: C.OK, amount: apiData.data.amount};
            }
        } else {
            logger.error('[fishHunterPlayer][callFetchBalance][RES] playerId: %s, fetchBalance webConnector failed ：', player._id, JSON.stringify(apiData));
            return {code: C.API_AUTH_FAIL};
        }
    } catch (err) {
        if (!!err.error && typeof err.error == 'object') {
            let msg = _.toString(err.error);
            if (msg.indexOf('socket hang up') > -1) return {
                code: C.API_AUTH_TIME_OUT,
                apiErrorCode: C.API_AUTH_TIME_OUT
            }; // API超時
        } else {
            logger.error('[fishHunterPlayer][callFetchBalance] playerId: %s, catch err: ', player._id, err);
        }
        return {code: C.ERROR};
    }
});

proto.getBackendSessions_rpc = P.coroutine(function* (player) {
    try {
        let self = this;
        let bss = self.app.get('backendSessionService');
        if (!player.connectorId || player.connectorId == '') { // 玩家已斷線，connectorId 不存在。
            return null;
        } else {
            let sessions = yield P.promisify(bss.getByUid, bss)(player.connectorId, player._id);
            return {sessions, rpc: self.app.rpc.fishHunterBackend.areaRemote};
        }
    } catch (err) {
        logger.warn('[fishHunterPlayer][getBackendSessions_rpc] player: %s, err ：', JSON.stringify(player), err);
        return null;
    }
});

proto.callKeepAlive = P.coroutine(function* (player) {
    try {
        let self = this;
        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.APIMethod.keepAlive,
            platform: consts.APIServerPlatform.api,
            dc: player.dc,
            // agentId:      session.get('agentId'),
            launchToken: player.launchToken,
            playerId: player._id,
            gameId: player.gameId,
            ggId: 1,
            dsUseDc: player.dsUseDc,         // 域名設定使用的dc
        };
        logger.warn('[fishHunterPlayer][callKeepAlive][CallAPI] KeepAlive ：', opts);

        let apiData;
        if (player.demo !== consts.demoType.demo) {
            // 正式or測試帳號
            apiData = yield utils.httpPost(url, opts);
        } else {
            logger.warn('[fishHunterPlayer][callKeepAlive] getOneCallKeepAliveRes');
            apiData = self.app.controllers.accountDemo.getOneCallKeepAliveRes();
            logger.warn('[fishHunterPlayer][callKeepAlive][getOneCallKeepAliveRes] apiData：', apiData);
        }

        if (!!apiData && apiData.status == apiCode.SUCCESS) {

            if (!!apiData.data.status) {
                switch (apiData.data.status) {
                    case C.API_RETURN_TOKEN_EXPIRED:
                        logger.warn('[fishHunterPlayer][callKeepAlive][RES] playerId: %s, KeepAlive token expired：', player._id, JSON.stringify(apiData));
                        self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.API_AUTH_FAIL);
                        break;
                    default:
                        logger.error('[fishHunterPlayer][callKeepAlive][RES] playerId: %s, KeepAlive API failed ：', player._id, JSON.stringify(apiData));
                        break;
                }
                return {code: C.API_AUTH_FAIL, apiErrorCode: apiData.data.status};
            } else {
                logger.info('[fishHunterPlayer][callKeepAlive][RES] playerId: %s, KeepAlive : ', player._id, apiData);
                return {code: C.OK, amount: apiData.data.amount};
            }
        } else {
            logger.error('[fishHunterPlayer][callKeepAlive][RES] playerId: %s, KeepAlive webConnector failed ：', player._id, JSON.stringify(apiData));
            return {code: C.API_AUTH_FAIL};
        }
    } catch (err) {
        logger.error('[fishHunterPlayer][callKeepAlive] playerId: %s, err ：', player._id, err);
    }
});

proto.getGameSettlementState = async function (player, gameId, backendServerId) {
    try {
        // 沒有玩過，不檢查
        if (!gameId) return true;
        let self = this;
        let playerId = player._id;
        let tokenDao = self.app.controllers.daoMgr.getGameTokenDao();
        let gameSettlementDone = true;
        // 判斷前一場是否結帳完成
        switch (player.isSingleWallet) {
            // 多錢包
            case consts.walletType.multipleWallet:
                let tokens = await tokenDao.findOneAsync(playerId, gameId, true);
                logger.info(`[fishHunterPlayer][gameSettlementDone] check tokens state. playerId: ${playerId}, state: ${tokens.state}, tokens: ${JSON.stringify(tokens)}`);
                if (tokens.state == consts.WalletState.settling) {
                    gameSettlementDone = false;
                }
                break;
            // 後扣型錢包
            case consts.walletType.singleBetAndWinDelay:
                if (backendServerId) {
                    let rpc = self.app.rpc.fishHunterBackend.areaRemote.checkGameSettlementDone;
                    // 檢查是否已經結帳完成 // 使用上一場登入的 gameId(未來多開，再改成現在登入的gameId)
                    gameSettlementDone = await P.promisify(rpc.toServer, rpc)(backendServerId, playerId, gameId, consts.route.client.clientAction.twLogin);
                }
                break;
        }
        return gameSettlementDone;
    } catch (err) {
        logger.warn(`[fishHunterPlayer][getGameSettlementState] playerId: ${player._id}, odlGameId:${gameId}, backendServerId:${backendServerId}, err:`, err);
        return true;
    }
};

proto.getPlayerSessionId = async function (player, from) {
    try {
        let self = this;
        let playerId = player._id;
        // 玩家已斷線，connectorId 不存在
        if (!player.connectorId || player.connectorId === '') {
            return null;
        }
        // 取得玩家 sessionId

        const accountRemote = self.app.rpc.connector['accountRemote'];
        const sessionId = await P.promisify(
            accountRemote.getPlayerSessionId,
            accountRemote
        )({frontendId: player.connectorId}, playerId);

        if (!sessionId) {
            logger.info(`[fishHunterPlayer][getPlayerSessionId] playerId: ${playerId}, from: ${from}, sessionId: ${sessionId}`);
        }
        return sessionId;
    } catch (err) {
        logger.error(`[fishHunterPlayer][getPlayerSessionId] playerId: ${player._id}, from: ${from}, err:`, err);
        throw err;
    }
};