let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('fire', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');
let utils = require('../../../utils/utils');
const util = require('util');
const {Ret} = require("../../../utils/format-util");
let m_objRNGMethod;
let m_bShowTimeGap = false;

let Handler = function (app) {
    this.app = app;
    let strRNGPath = './lib/RNG/GameLogicInterface';
    // let strRNGPath = app.getBase() + '/lib/RNG/GameLogicInterface';
    m_objRNGMethod = utils.randProbability.loadRNGDll(strRNGPath);

    // if (this.app.get('env') == 'development')
    // if (this.app.get('env') == 'production')
    m_bShowTimeGap = true;
};

module.exports = function (app) {
    return new Handler(app);
};

let proto = Handler.prototype;
let cort = P.coroutine

proto.onFire = cort(function* (msg, session, next) {
    // // test extraBet
    // msg.query.cost = 30;
    // return this.onExtraBet(msg, session, next);
    // 驗證耗時用
    let dt = 0;
    if (m_bShowTimeGap) {
        dt = Date.now();
    }
    const params = msg.query || msg.body;
    try {
        const self = this;
        self.app.controllers.debug.client(msg, session);
        if (!session.uid) {
            throw new Error("session not found");
        }
        const playerId = session.uid;
        let gameId = session.get("gameId");
        const gameServerId = session.get("gameServerId");
        let funName = `playerId: ${playerId}, gameId: ${gameId} [onFire]`;

        // 驗證耗時用
        if (m_bShowTimeGap) {
            dt = utils.checkTimeGap(dt, funName, 1);
        }

        // 取得參數設定檔
        const config = self.app.controllers.fishHunterConfig.getParamDefinConfig();
        if (!params.hasOwnProperty('angle')) {
            throw new Error("illegal param config, missing angle");
        }

        // 驗證耗時用
        if (m_bShowTimeGap) {
            dt = utils.checkTimeGap(dt, funName, 2);
        }

        const playerDao = self.app.controllers.daoMgr.getPlayerDao();
        const player = yield playerDao.findByIdAsync(playerId, true, gameServerId);
        if (!player) {
            throw new Error("PLAYER_NOT_FOUND");
        }

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 3); // 驗證耗時用

        // 檢查玩家 session
        let sessionId = yield self.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onFire');
        if (!sessionId) return next(null, {code: C.ERROR});

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 4, 3000); // 驗證耗時用

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.onFire)) {
            return next(null, {code: C.ERROR});
        }

        // 檢查玩家遊戲狀態
        let check = yield self.checkPlayerPlaying(player, params)
        if (check.code !== C.OK) {
            return next(null, {code: check.code, level: params.level});
        }

        let bulletId = params.bulletId;
        player['roundID'] = session.get('roundID');

        // let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
        // let areaPlayer = yield modelAreaPlayers.findOneReadOnlyAsync({areaId: player.areaId, playerId: playerId});
        let areaPlayerDao = self.app.controllers.daoMgr.getAreaPlayerDao();
        let areaPlayer = yield areaPlayerDao.findOneAsync(player.areaId, playerId, true, gameServerId);
        if (!areaPlayer) {
            self.app.controllers.debug.info('error', 'onFire', {
                playerId: player._id,
                areaId: player.areaId,
                params: params,
                bulletId: params.bulletId,
                reason: 'areaPlayer not exist'
            });
            return next(null, {code: C.PLAYER_NOT_PLAYING, level: params.level});
        }

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 5); // 驗證耗時用

        let cache = self.app.controllers.fishHunterCache;
        gameId = player.gameId;
        let tableLevel = player.tableLevel;
        let gameConfig = self.app.controllers.fishHunterConfig.getGameConfig(gameId, tableLevel);
        let currency = player.currency ? player.currency : 'CNY';
        let betSetting = session.get('betSetting');
        if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
            logger.error(`[areaHandler][onFire] no betSetting! playerId: ${player._id}`);
            return next(null, {code: C.ERROR, level: params.level});
        }
        // let currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfigByDC(player.dc);
        // if (!currencyConfig) currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfig();
        // let currencyCannon = currencyConfig[(currency)].cannon;
        let cannon = {
            maxBullets: gameConfig.cannon.maxBullets || 20,
            // cost: currencyCannon.cost[tableLevel],
            // level: currencyCannon.level[tableLevel]
            cost: betSetting.info.levels[tableLevel].cannon.cost,
            level: betSetting.info.levels[tableLevel].cannon.level
        };

        // 檢查一般子彈數量是否超標
        if (params.level !== consts.FishType.DRILL && params.level !== consts.FishType.LASER) {
            let bulletsCount = self.app.controllers.fishHunterCache.bullets(playerId).length;
            if (bulletsCount >= cannon.maxBullets) {
                self.app.controllers.debug.info('warn', 'onFire', {
                    playerId: player._id,
                    bulletId: bulletId,
                    areaId: player.areaId,
                    params: params,
                    reason: 'bulletsCount(' + bulletsCount + ') >= cannon.maxBullets(' + cannon.maxBullets + ')'
                });
                return next(null, {code: C.FISH_PLAYER_MAX_BULLETS, level: params.level});
            }
        }

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 6); // 驗證耗時用

        let ret = null;
        // 特殊武器
        if (config.weapon.indexOf(params.level) !== -1) {
            // if (!areaPlayer.gunEx){
            //   self.app.controllers.debug.info('warn','onFire',{
            //     playerId:   playerId,
            //     areaId:     player.areaId,
            //     params:     params,
            //     reason:     'gunEx not exist'
            //   });
            //   return next(null, {code: C.PLAYER_WEAPON_NOT_EXIST});
            // }

            ret = yield self.app.controllers.onFire.onWeaponShootAsync(player, params, areaPlayer, gameServerId);

            if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, `[weapon]${funName}`, 7, 300); // 驗證耗時用
        }
        // 一般子彈
        else {
            // 飛機遊戲
            if (_.isArray(bulletId)) {
                let count = bulletId.length;
                if (count <= 0) {
                    throw new Error("bullet count == 0");
                }
                // 回傳前端 notice: game.fire
                let rebullet = {
                    alive: [], angle: [], bulletId: [], cost: [],
                    level: [], lockTargetId: [], shootType: [], position: [],
                }

                let isError = false;
                let code = 200;
                for (let i = 0; i < count; i++) {

                    // 檢查玩家cost與砲台等級是否符合
                    if (areaPlayer.cannonLevel < 0
                        || areaPlayer.cannonLevel >= cannon.cost.length
                        || cannon.cost.indexOf(params.cost[i]) < 0) {
                        self.app.controllers.debug.info('warn', 'onFire', {
                            playerId: player._id,
                            areaId: player.areaId,
                            params: params,
                            bulletId,
                            areaPlayerCannonLevel: areaPlayer.cannonLevel,
                            cost: params.cost[i],
                            CannonCost: cannon.cost,
                            reason: 'cannonLevel invalid'
                        });
                        return next(null, {code: C.ERROR});
                    }

                    // 玩家子彈ID重複發射: 踢下線
                    if (!!cache.bulletData(playerId, bulletId[i])) {
                        // self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, consts.KickUserReason.BulletIdDuplicate);
                        self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.FISH_PLAYER_BULLETID_DUPLICATE);
                        self.app.controllers.debug.info('warn', 'onFire', {
                            playerId: playerId,
                            areaId: player.areaId,
                            reason: 'bulletId is duplicate, is ' + bulletId[i] + " , Player kick !"
                        });
                        isError = true;
                        code = C.FISH_PLAYER_BULLETID_DUPLICATE;
                        break;
                    }

                    ret = yield self.app.controllers.onFire.onFireAsync(player, {
                        bulletId: bulletId[i],
                        angle: params.angle[i],
                        lockId: params.lockId[i],
                        cost: params.cost[i],
                        level: params.level[i],
                        shootType: params.shootType[i],
                        position: params.position[i]
                    }, areaPlayer, currency, cannon, params.cost[i], betSetting);

                    if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, `[normalArray]${funName}`, `7-${i}`, 300); // 驗證耗時用

                    if (!ret.error) {
                        // 回傳前端 notice: game.fire
                        Object.keys(rebullet).forEach((key) => {
                            rebullet[key].push(ret.obj.bullet[key]);
                        });
                    } else {
                        isError = true;
                        code = ret.error;
                        logger.warn(`[areaHandler][onFire] fire x5 playerId: ${playerId}, code: ${code}, bulletId: ${bulletId[i]}`);
                        break;
                    }
                } /* for-end */

                if (isError) {
                    logger.warn(`[areaHandler][onFire] fire x5 has fail playerId: ${playerId}, ret: ${JSON.stringify(rebullet)}`);
                    return next(null, {code: code});
                }

                // 回傳前端 notice: game.fire
                rebullet['chairId'] = ret.obj.bullet.chairId;
                rebullet['playerId'] = playerId;
                ret.obj.bullet = rebullet;

            } else {
                let cost = Math.abs(params.cost);

                // 檢查玩家cost與砲台等級是否符合
                if (areaPlayer.cannonLevel < 0
                    || areaPlayer.cannonLevel >= cannon.cost.length
                    || cannon.cost.indexOf(cost) < 0) {
                    self.app.controllers.debug.info('warn', 'onFire', {
                        playerId: player._id,
                        areaId: player.areaId,
                        params: params,
                        bulletId,
                        areaPlayerCannonLevel: areaPlayer.cannonLevel,
                        cost: cost,
                        CannonCost: cannon.cost,
                        reason: 'cannonLevel invalid'
                    });
                    return next(null, {code: C.ERROR, level: params.level});
                }
                // 玩家子彈ID重複發射: 踢下線
                if (!!cache.bulletData(playerId, bulletId)) {
                    // self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, consts.KickUserReason.BulletIdDuplicate);
                    self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.FISH_PLAYER_BULLETID_DUPLICATE);
                    self.app.controllers.debug.info('warn', 'onFire', {
                        playerId: playerId,
                        areaId: player.areaId,
                        reason: 'bulletId is duplicate, is ' + bulletId + " , Player kick !"
                    });
                    return next(null, {code: C.FISH_PLAYER_BULLETID_DUPLICATE, level: params.level});
                }

                ret = yield self.app.controllers.onFire.onFireAsync(player, params, areaPlayer, currency, cannon, cost, betSetting);

                if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, `[normal]${funName}`, 7, 300); // 驗證耗時用
            }
        }

        // if (ret.error) return next(null, {code: ret.error, level: params.level});
        if (ret.error) {
            throw new Error(ret.error);
        }

        self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.FIRE, ret.obj, false);
        Ret.data(next, {
            level: params.level,
        });
    } catch (err) {
        logger.error('[areaHandler][onFire] playerId: %s, err: ', session.uid, err);
        Ret.error(next, "", err, C.ERROR, {
            level: params.level
        });
    }
});

proto.onCollider = cort(function* (msg, session, next) {
    // 驗證耗時用
    let dt = 0;
    if (m_bShowTimeGap) {
        dt = Date.now();
    }
    try {
        this.app.controllers.debug.client(msg, session);
        if (!session.uid) {
            return next(null, {code: C.ILLEGAL});
        }
        // let playerControl = this.app.controllers.fishHunterPlayer;
        const params = msg.query || msg.body;
        const playerId = session.uid;
        const gameId = session.get('gameId');
        const gameServerId = session.get("gameServerId");
        let funName = `playerId: ${playerId}, gameId: ${gameId} [onCollider]`;



        // 驗證耗時用
        if (m_bShowTimeGap) {
            dt = utils.checkTimeGap(dt, funName, 1);
        }

        const playerDao = this.app.controllers.daoMgr.getPlayerDao();
        const player = yield playerDao.findByIdAsync(playerId, true, gameServerId);
        if (!player) {
            throw new Error("PLAYER_NOT_FOUND");
        }

        // 驗證耗時用
        if (m_bShowTimeGap) {
            dt = utils.checkTimeGap(dt, funName, 2);
        }

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onCollider');
        if (!sessionId) {
            throw new Error("Session ID Not Found");
        }

        // 驗證耗時用
        if (m_bShowTimeGap) {
            dt = utils.checkTimeGap(dt, funName, 3, 3000);
        }

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.onCollider)) {
            throw new Error("Invalid Game State");
        }
        if (!player.tableId) {
            this.app.controllers.debug.info('error', 'areaHandler.onCollider', {
                playerId: player._id,
                areaId: player.areaId,
                colliderData: params,
                reason: 'player.tableId not exist, is ' + player.tableId
            });
            throw new Error("TABLE_NOT_FOUND");
        }
        if (player.gameState !== consts.GameState.PLAYING) {
            this.app.controllers.debug.info('warn', 'areaHandler.onCollider', {
                playerId: player._id,
                areaId: player.areaId,
                colliderData: params,
                reason: 'player not PLAYING, is ' + player.gameState
            });
            throw new Error("PLAYER_AREA_NOT_EXIST");
        }

        if (!player.areaId) {
            throw new Error("PLAYER_AREA_NOT_EXIST");
        }

        let killFirst = false;
        let noDieFirst = false;
        //擋測試模式才可使用
        if (this.app.get('env') === 'development') {
            killFirst = session.get('onKillFirst') || killFirst;
            noDieFirst = session.get('onNoDiefirst') || noDieFirst;
            if (killFirst || noDieFirst) {
                session.set('onKillFirst', false);
                session.set('onNoDiefirst', false);
                session.pushAll();
            }
        }

        player['roundID'] = session.get('roundID');

        const ret = yield this.app.controllers.collider.checkBulletsAsync(player, params, {
            killFirst,
            noDieFirst
        }, gameServerId, session.get('betSetting'));

        // 驗證耗時用
        if (m_bShowTimeGap) {
            dt = utils.checkTimeGap(dt, funName, 4, 500);
        }

        if (ret.error) {
            Ret.error(next, ret.error);
        }
        return Ret.data(next, ret.data);
    } catch (err) {
        logger.error('[areaHandler][onCollider] playerId: %s, err: ', session.uid, err);
        Ret.error(next, "", err);
    }
});

proto.channelSend = function (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        let params = msg.query || msg.body;

        // let rid = session.get('rid');
        let username = session.uid;
        // let channelService = this.app.get('channelService');
        // let channel = channelService.getChannel(rid, false);
        let globalPush = this.app.get('globalChannelService');

        let now = Date.now();
        let param = {
            route: 'onPush',
            msg: params.content,
            from: username,
            target: params.target,
            perf: globalPush['perfInfo'],
            time: now,
            elapse: now - params.time
        };

        //the target is all users
        if (params.target === '*') {
            const content = param || {};
            logger.info("[fishHunterPlayer][pushAsync]", [username], param.route, content);
            globalPush.pushMessageByUidArr([username], param.route, content);
        }
        next(null, {
            route: msg.route
        });
    } catch (ex) {
        logger.error("backend areaHandler.channelSend() failure", ex);
        Ret.error(next, "", ex);
    }
};

proto.getTime = function (msg, session, next) {
    // this.app.controllers.debug.client( msg, session );
    if (!session.uid) return next(null, {code: C.ILLEGAL});
    let params = msg.query || msg.body;
    let now = Date.now();
    // cTime: client time // time: server time
    next(null, {code: C.OK, cTime: params.now, time: now});
}

proto.cancelFire = cort(function* (msg, session, next) {
    try {
        let self = this;
        self.app.controllers.debug.client(msg, session);
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let params = msg.query || msg.body;
        let playerId = session.uid;


        let player = yield self.app.controllers.fishHunterPlayer.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield self.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'cancelFire');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查玩家遊戲狀態
        let check = yield self.checkPlayerPlaying(player, params)
        if (check.code != C.OK) return next(null, {code: check.code});

        let bulletId = params.bulletId;
        let cache = self.app.controllers.fishHunterCache;
        let bullet = null;
        let cancelCacheKey = [
            playerId, player.areaId, player.tableId, player.gameId, player.tableLevel,
            player.isSingleWallet, player.isPromo, player.dc, player.currency, session.get('betSetting').exchangeRate
        ].join(':');

        if (_.isArray(bulletId)) {
            let errorbulletId = [];
            let isNull = false;
            let notFindVoucherbId = [];
            for (let bid of bulletId) {
                bullet = cache.bulletData(playerId, bid);
                if (!bullet) {
                    isNull = true;
                    errorbulletId.push(bid);
                    continue;
                } else {
                    if (bullet.denom != 1) {
                        bullet.cost = utils.scoreToCash(bullet.cost, bullet.denom);
                        bullet.denom = 1;
                    }

                    cache.addCancelBullets(cancelCacheKey, bid, bullet.cost); // 新增需退款的 cancel bullet
                }
                cache.DestroyBullet(playerId, bid); // 刪除子彈 cache [DB_BULLETS_INIT]
            }
            // 其中有一顆子彈ID不存在或已碰撞: 踢下線
            if (isNull) {
                self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.PLAYER_CANCEL_BULLETID_NOT_EXIST);
                self.app.controllers.debug.info('warn', 'cancelFire', {
                    playerId: playerId,
                    areaId: player.areaId,
                    bullet: bullet,
                    reason: 'One of the bulletId not exist, is ' + errorbulletId + " , Player kick !"
                });
                return next(null, {code: C.PLAYER_BULLETID_NOT_EXIST});
            }

            return next(null, {code: C.OK});
        } else {
            bullet = cache.bulletData(playerId, bulletId);
            // 子彈ID不存在或已碰撞: 踢下線
            if (!bullet) {
                self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.PLAYER_CANCEL_BULLETID_NOT_EXIST);
                self.app.controllers.debug.info('warn', 'areaHandler.cancelFire', {
                    playerId: playerId,
                    areaId: player.areaId,
                    reason: 'bulletId not exist, is ' + bulletId + " , Player kick !"
                });
                return next(null, {code: C.PLAYER_BULLETID_NOT_EXIST});
            } else {
                if (bullet.denom != 1) {
                    bullet.cost = utils.scoreToCash(bullet.cost, bullet.denom);
                    bullet.denom = 1;
                }

                cache.addCancelBullets(cancelCacheKey, bulletId, bullet.cost); // 新增需退款的 cancel bullet
            }
            cache.DestroyBullet(playerId, bulletId); // 刪除子彈 cache [DB_BULLETS_INIT]

            return next(null, {code: C.OK});
        }

    } catch (err) {
        logger.error('[areaHandler][cancelFire] playerId: %s, err: ', session.uid, err);
        return next(null, {code: C.ERROR});
    }
});

proto.onPickLuckyDraw = cort(function* (msg, session, next) {
    try {
        let self = this;

        self.app.controllers.debug.client(msg, session);
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let params = msg.query || msg.body;
        let playerId = session.uid;
        let pickIdx = params.pickIdx;
        let gameId = session.get("gameId");


        let player = yield self.app.controllers.fishHunterPlayer.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onPickLuckyDraw');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查玩家遊戲狀態
        let check = yield self.checkPlayerPlaying(player, params)
        if (check.code != C.OK) return next(null, {code: check.code});

        // 找集寶器設定檔
        let collectionDrawConfig = self.app.controllers.fishHunterConfig.getCollectionDrawConfig(gameId);
        if (!collectionDrawConfig) return next(null, {code: C.ERROR});

        // 取集寶器紀錄
        let modelCollection = self.app.models.CollectionHistory;
        let collectionId = modelCollection.getId(player._id, gameId);
        let collection = yield modelCollection.findByIdAsync(collectionId);
        if (!collection) return next(null, {code: C.ERROR});

        // 是否集滿
        if (collection.count < collectionDrawConfig.collectionCount) return next(null, {code: C.ERROR});

        let gain;
        let treasureInfo;
        // 選擇結果
        if (pickIdx == 0) {
            // 固定倍數
            gain = utils.number.multiply(collection.cost, collectionDrawConfig.collectionAvgOdds);
        } else {
            // 隨機bonus

            let levels = collection.levels;
            // 取觸發的bonus
            let randomResult = utils.randProbability.getRand(collectionDrawConfig.collectionDraw[1].tabvals, 'triggerprob', m_objRNGMethod);
            let bonusType = randomResult.bonusType;

            // 抽要哪個level的TABLE
            let randomTable = utils.randProbability.getRand(randomResult.val[levels], 'tabprob', m_objRNGMethod);
            // 抽倍數結果
            randomTable = utils.randProbability.getRand(randomTable.tabvals, 'prob', m_objRNGMethod);
            let randomScore = randomTable.val;
            // 取bonus結構
            let data = {};
            data.odds = randomScore;
            data.cost = collection.cost;
            const bonusConfig = self.app.controllers.fishHunterConfig.getBonusConfig(gameId);
            const weaponAliveAlgConfig = self.app.controllers.fishHunterConfig.getWeaponAliveAlgConfig(gameId);
            treasureInfo = yield self.app.controllers.treasure.getTreasureByType(
                data,
                bonusConfig, weaponAliveAlgConfig,
                bonusType,
                levels,
                player
            );

            gain = treasureInfo.amount; // 直接使用 treasure 內算好的值

            let rpc = self.app.rpc.fishHunter.areaRemote;
            // 取 RC 設定
            let randomFishesDieRes = yield P.promisify(rpc.getRandomFishesDie.toServer, rpc.getRandomFishesDie)(session.get("gameServerId"), null, gain, player.tableLevel, data.cost, gameId, 'Fish_100', 'flock', player, false);
            if (!!randomFishesDieRes) {
                let _res = _.cloneDeep({rcCheck: randomFishesDieRes.rcCheck});
                let rcCheck = _res.rcCheck.check;
                if (!!rcCheck && rcCheck.hasOwnProperty('totalCost') && rcCheck.hasOwnProperty('totalGain')) {
                    _res.rcCheck.check.totalGain = utils.number.add(rcCheck.totalGain, gain);
                    // 風控檢查(未捕獲觸發或額外觸發)
                    let subuki_res = self.app.controllers.subuki.checkSUBUKI_ExtraTrigger(_res, gameId);
                    if (!subuki_res) {
                        // 超出風控: 取最小賠率
                        treasureInfo = yield self.app.controllers.treasure.getTreasureByType(data, bonusConfig, weaponAliveAlgConfig, bonusType, levels, player, true, randomResult);
                        gain = treasureInfo.amount; // 直接使用 treasure 內算好的值
                        logger.warn(`[areaHandler][onPickLuckyDraw] 超出風控 playerId: ${playerId}, gain: ${gain}, treasureInfo: `, treasureInfo);
                    }
                } else {
                    // 找不到 totalCost & totalGain: 取最小賠率
                    treasureInfo = yield self.app.controllers.treasure.getTreasureByType(data, bonusConfig, weaponAliveAlgConfig, bonusType, levels, player, true, randomResult);
                    gain = treasureInfo.amount; // 直接使用 treasure 內算好的值
                    logger.error(`[areaHandler][onPickLuckyDraw] not find rcCheck.check.totalCost playerId: ${player._id}, gain: ${gain}, treasureInfo: `, treasureInfo);
                }
            } else {
                // call rpc 失敗: 取最小賠率
                treasureInfo = yield self.app.controllers.treasure.getTreasureByType(data, bonusConfig, weaponAliveAlgConfig, bonusType, levels, player, true, randomResult);
                gain = treasureInfo.amount; // 直接使用 treasure 內算好的值
                logger.warn(`[areaHandler][onPickLuckyDraw] call rpc 失敗 playerId: ${playerId}, gain: ${gain}, treasureInfo: `, treasureInfo);
            }
        }

        // 試玩帳號 派彩 不進rc統計 // 先加 RC 再派彩
        if (!player.demo)
            self.app.controllers.fishHunterRC.addRecord(player.currency, gameId, player.tableLevel, gain, self.app.controllers.fishHunterRC.RC_EVENT.GAIN, player.dc, session.get('betSetting').exchangeRate);

        let getInfocb = null;
        let subId = utils.shortid();
        let memWallet = yield self.app.controllers.walletMgr.getWalletAsync(playerId, gameId);
        let otherData = {isBonusGame: 1, shootType: collection.shootType};
        let ret = memWallet.betResult(gain, memWallet.ratio, 0, otherData, (err, data) => {
            const {wagerId, idx, betSucc, winSucc, code} = data;
            logger.debug('onPickLuckyDraw betResult ', util.inspect({
                wagerId,
                code,
                idx,
                betSucc,
                winSucc,
                bulletIdcb: collection.bulletId,
                getInfocb
            }, false, 10));
            if (!err && betSucc) {
                //正常

                return true;
            } else {
                logger.info(`[areaHandler][onPickLuckyDraw][betResult] playerId: ${playerId}`, util.inspect({
                    wagerId,
                    code,
                    subId,
                    idx,
                    betSucc,
                    winSucc,
                    bulletIdcb,
                    getInfocb
                }, false, 10));

                //错误处理
                if (!betSucc) {
                    // 後扣型錢包
                    if (player.isSingleWallet == consts.walletType.singleBetAndWinDelay) {
                        // 一般子彈
                        if (collection.shootType == 'normal') {
                            if (code == C.API_AUTH_TIME_OUT) {
                                // api 回傳 timeout 或 retry // redis 存入一般子彈可能扣款成功的 subId
                                self.app.controllers.redisCache.addSubIdFromAPIfail(player.gameServerId, subId, wagerId, wagerId);
                            }
                        }
                        // 免費子彈
                        else {
                            if (code !== C.API_AUTH_TIME_OUT) {
                                // 扣款失敗 // 刪除 memdb 已存入的子單
                                self.app.controllers.daoMgr.getBulletHistoryDao().removeByIdAsync(subId);
                            }
                        }
                    }

                }
                return true;
            }
        });

        let getInfo = {
            originalCost: collection.cost,
            treasure: {
                odds: treasureInfo ? treasureInfo.jps.resultList : collectionDrawConfig.collectionAvgOdds,
                bonus: gain,
                type: treasureInfo ? treasureInfo.type : 'LuckyDraw'
            }
        };
        getInfocb = getInfo;

        let bulletData = {
            _id: subId,
            wId: memWallet.wagerId,
            bulletId: collection.bulletId,
            gain: gain,
            shootType: collection.shootType,
            denom: memWallet.ratio,
            getInfo: getInfo,
            idx: ret.lastIndex,
            cost: 0,
            alive: -1,
            areaId: player.areaId,
            playerId: playerId,
            createTime: utils.timeConvert(Date.now()),
            endReason: collection.shootType == 'normal' ? 'CollidReward' : 'WeaponReward',
            hitFishes: 'Fish_100|flock',
            killFishes: true,
        }
        // 新增一筆 bullet cache
        self.app.controllers.fishHunterCache.addOneBulletHistory(bulletData);
        // 儲存子單
        yield self.app.controllers.bullet.saveOneBulletToMemDB(player, bulletData._id, bulletData.wId);
        // 清除集寶器紀錄
        yield collection.removeAsync();

        //update gameToken
        self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_BALANCE, {
            pid: player._id,
            balance: memWallet.getRealTokens()
        }, false);

        let data = {playerId, amount: gain, treasureInfo};
        // self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.LUCKY_DRAW, data, false);
        return next(null, {code: C.OK, data});

    } catch (err) {
        logger.error('[areaHandler][onPickLuckyDraw] playerId: %s, err: ', session.uid, err);
        return next(null, {code: C.ERROR});
    }
});

proto.onExtraBet = cort(function* (msg, session, next) {
    try {
        let self = this;
        self.app.controllers.debug.client(msg, session);
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let params = msg.query || msg.body;
        let playerId = session.uid;
        let gameId = session.get("gameId");
        let cost = params.cost;
        // 檢查前端送的cost是否溢位
        let point = _.toString(cost).split('.')[1];
        if (!!point && point.length > 2) return next(null, {code: C.ERROR, msg: 'Cost is wrong.'});

        // 檢查玩家
        let player = yield self.app.controllers.fishHunterPlayer.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});
        let currency = player.currency ? player.currency : 'CNY';
        let check = yield self.checkPlayerPlaying(player, params)
        if (check.code != C.OK) return next(null, {code: check.code});

        // 檢查玩家 session
        let sessionId = yield self.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onExtraBet');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 找 extraBetTime 設定檔
        const fishTypeConfig = this.app.controllers.fishHunterConfig.getFishTypeConfig(gameId);
        if (!fishTypeConfig.extraBetTime) return next(null, {code: check.code});
        // 驗證原始bet (cost = bet * extraBetTime)
        let bet = utils.number.divide(cost, fishTypeConfig.extraBetTime);
        if (!cost || cost < 0) return next(null, {code: C.ERROR, reason: 'cost = ' + cost});
        if (!bet || bet < 0) return next(null, {code: C.ERROR, reason: 'bet = ' + bet});

        // // 找area
        // let area = this.app.controllers.fishHunterCache.findFishArea(player.areaId);
        // if (!area) return next(null, {code: C.PLAYER_AREA_NOT_EXIST, reason: 'Area not exist !!'});
        // if (area.state !== consts.AreaState.START) return next(null, {code: C.ERROR, reason: 'Area not start !!'});
        // // 換場期間
        // if (area.stage == consts.AreaStage.WAIT) return next(null, {code: C.ERROR, reason: 'Change scene !!'});

        // 找 areaPlayer
        let gameServerId = session.get("gameServerId");
        let areaPlayerDao = self.app.controllers.daoMgr.getAreaPlayerDao();
        let areaPlayer = yield areaPlayerDao.findOneAsync(player.areaId, playerId, true, gameServerId);
        if (!areaPlayer) return next(null, {code: C.PLAYER_NOT_PLAYING});

        // 取投注設定
        let betSetting = session.get('betSetting');
        if (!betSetting) return next(null, {code: C.ERROR, reason: 'betSetting = ' + betSetting});

        let tableLevel = player.tableLevel;
        let cannon = {
            cost: betSetting.info.levels[tableLevel].cannon.cost,
        };
        if (areaPlayer.cannonLevel < 0
            || areaPlayer.cannonLevel >= cannon.cost.length
            || cannon.cost.indexOf(bet) == -1) {
            self.app.controllers.debug.info('warn', 'onExtraBet', {
                playerId: player._id,
                areaId: player.areaId,
                params: params,
                areaPlayerCannonLevel: areaPlayer.cannonLevel,
                cost: cost,
                bet: bet,
                CannonCost: cannon.cost,
                reason: 'cannonLevel invalid'
            });
            return next(null, {code: C.ERROR});
        }

        // 執行 ExtraBet 事件
        let ret = yield self.app.controllers.onExtraBet.onExtraBetAsync(player, areaPlayer, currency, cost, betSetting, fishTypeConfig.extraBetTime);
        if (ret.error != C.OK) return next(null, {code: ret.error});

        // 通知所有人
        self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.EXTRA_BET, {pid: playerId}, false);

        let killFirst = false;
        let noDieFirst = false;
        //擋測試模式才可使用
        if (this.app.get('env') == 'development') {
            killFirst = session.get('onKillFirst') || killFirst;
            noDieFirst = session.get('onNoDiefirst') || noDieFirst;
            if (killFirst || noDieFirst) {
                session.set('onKillFirst', false);
                session.set('onNoDiefirst', false);
                session.pushAll();
            }
        }

        // 執行碰撞
        let data = [];
        data.push({bid: ret.bulletId, fid: 0});
        ret = yield this.app.controllers.collider.checkBulletsAsync(player, data, {
            killFirst,
            noDieFirst
        }, gameServerId, betSetting, fishTypeConfig.extraBetTime);

        // 個人事件回傳
        return next(null, {code: C.OK});
    } catch (err) {
        logger.error('[areaHandler][onExtraBet] playerId: %s, err: ', session.uid, err);
        return next(null, {code: C.ERROR});
    }
});

proto.checkPlayerPlaying = cort(function* (player, params) {
    try {
        let self = this;
        let playerId = player._id;

        switch (player.accountState) {
            case consts.AccountState.SUSPEND:
                self.app.controllers.debug.info('warn', 'checkPlayerPlaying', {
                    playerId: playerId,
                    userName: player.nickName,
                    reason: '下注失敗: 玩家帳號被停用, AccountState: ' + player.accountState,
                });
                return {code: C.PLAYER_STATE_SUSPEND};
            case consts.AccountState.FREEZE:
                self.app.controllers.debug.info('warn', 'checkPlayerPlaying', {
                    playerId: playerId,
                    userName: player.nickName,
                    reason: '下注失敗: 玩家帳號被凍結, AccountState: ' + player.accountState,
                });
                return {code: C.PLAYER_STATE_FREEZE};
        }
        // 桌子ID不存在
        if (!player.tableId) {
            self.app.controllers.debug.info('warn', 'checkPlayerPlaying', {
                playerId: playerId,
                areaId: player.areaId,
                params: params,
                reason: 'player.tableId not exist, is ' + player.tableId
            });
            return {code: C.TABLE_NOT_FOUND};
        }
        // 玩家狀態不是遊戲中
        if (player.gameState != consts.GameState.PLAYING || !player.gameServerId) {
            self.app.controllers.debug.info('warn', 'checkPlayerPlaying', {
                playerId: playerId,
                areaId: player.areaId,
                params: params,
                reason: 'player not PLAYING, is ' + player.gameState
            });
            return {code: C.PLAYER_NOT_PLAYING};
        }
        // 玩家areaId不存在
        if (!player.areaId) {
            self.app.controllers.debug.info('warn', 'checkPlayerPlaying', {
                playerId: playerId,
                params: params,
                reason: 'player.areaId not exist, is ' + player.areaId
            });
            return {code: C.PLAYER_AREA_NOT_EXIST};
        }
        return {code: C.OK};
    } catch (err) {
        logger.error('[areaHandler][checkPlayerPlaying] playerId: %s, err: ', player._id, err);
        return {code: C.ERROR};
    }
});
