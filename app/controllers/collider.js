'use strict';
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../share/constant');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('fire', __filename);
let utils = require('../utils/utils');
const uuid = require('uuid/v1');
const util = require('util');
const COMEUPANCE = true;    // 天譴開關, true: 沒有子彈Id快取但收到碰撞事件時，將會生成一發子彈去扣款碰撞，防止碰撞封包攻擊

let m_objRNGMethod;
let m_bShowTimeGap = false;

let Controller = function (app) {
    this.app = app;
    let strRNGPath = './lib/RNG/GameLogicInterface';        // Mac Used
    // let strRNGPath = app.getBase() + '/lib/RNG/GameLogicInterface';        // Win Used
    m_objRNGMethod = utils.randProbability.loadRNGDll(strRNGPath);
    // if (this.app.get('env') == 'development')
    // if (this.app.get('env') == 'production')
    m_bShowTimeGap = true;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

proto.checkBulletsAsync = cort(function* (player, colliderData, debugData, gameServerId, betSetting, extraBetTime) {
    try {
        let colliders = {};
        let angles = {};
        let duplicate_fid = false; // 是否檢查重複碰撞魚Id flag
        let killFirst = debugData.killFirst;
        let noDieFirst = debugData.noDieFirst;

        for (let i = 0; i < colliderData.length; i++) {
            if (!_.isNumber(colliderData[i].bid)) continue; // 過濾掉 bid 不等於 Number 形態的 ex. bid = null
            if (!colliders[colliderData[i].bid]) {
                colliders[colliderData[i].bid] = [];
                angles[colliderData[i].bid] = [];
            }

            let wp = this.app.controllers.fishHunterCache.getTreasure(player._id, colliderData[i].bid);
            if (!!wp &&
                (wp.shootType == consts.FishType.BOMB_CRAB ||
                    wp.shootType == consts.FishType.SERIAL_BOMB_CRAB ||
                    wp.shootType == consts.FishType.DRILL)
            ) {
                duplicate_fid = true;
            }

            // [炸彈螃蟹系列][鑽頭砲] 以外，需檢查碰撞的fid是否有重複
            if (!duplicate_fid && colliders[colliderData[i].bid].indexOf(colliderData[i].fid) > -1) {
                continue;
            }
            colliders[colliderData[i].bid].push(colliderData[i].fid);
            angles[colliderData[i].bid].push(colliderData[i].angle);  //電磁砲
        }

        let bidKeys = Object.keys(colliders);
        let self = this;
        let res;
        let colliderFailList = [];
        let count = bidKeys.length;
        let memWallet = yield self.app.controllers.walletMgr.getWalletAsync(player._id, player.gameId);
        if (!memWallet) {
            return {error: C.ERROR};
        }
        player.wId = memWallet.wagerId; // 塞入此刻 wId 給後面獲得特殊武器時，寫入 areaPlayer.gunInfo 裡，用於存在 addTreasure cache 內
        for (let i = 0; i < count; i++) {

            let obj = {
                'player': player,
                'bId': bidKeys[i],
                'hitFishes': colliders[bidKeys[i]],
                'angles': angles[bidKeys[i]],
                killFirst,
                noDieFirst
            };
            res = yield self.tryColliderAsync(obj, false, 0, gameServerId, betSetting, extraBetTime);

            // res在rpc前都是undefined
            if (res) {
                if (res.error == C.FISH_COLLIDER_NO_VOUCHER) {
                    logger.warn('playerId: %s, bulletId: %s 有子彈cache但找不到憑證, 延遲一秒後重新嘗試碰撞', player._id, obj.bId)
                    colliderFailList.push(obj);
                } else {
                    logger.warn('[collider][checkBulletsAsync] Fail, res.error: %s, obj: ', res.error, JSON.stringify(obj));
                }
            }
        }

        // // TODO: 現在沒有憑證了不應該找不到，待刪除
        // // 找不到扣款憑證的嘗試一秒後重新碰撞
        // if (colliderFailList.length > 0) {
        //   count = colliderFailList.length;
        //   for (let i = 0; i < count; i++) {
        //     self.app.timer.setTimeout(function () {
        //       self.tryColliderAsync(colliderFailList[i], true, 0, gameServerId, betSetting);
        //     }, 1000);
        //   }
        // }

        return {error: null, data: {}};
    } catch (err) {
        logger.error('[collider][checkBulletsAsync] player: %s, colliderData: %s, err: ', JSON.stringify(player), JSON.stringify(colliderData), err);
        // return {error: C.FAILD};
        throw err;
    }
});

proto.tryColliderAsync = cort(function* (oneColliderFail, isRetry, count, gameServerId, betSetting, extraBetTime) {
    try {
        if (count > 4) {
            logger.error('[collider][tryColliderAsync] 嘗試重新碰撞，超過五次 playerId: %s, count: %s, bulletId: ', oneColliderFail.player._id, count, oneColliderFail.bId);
            return;
        }
        let self = this;
        let isWeapon = false;
        let cache = self.app.controllers.fishHunterCache;
        let player = oneColliderFail.player;
        let wp = cache.getTreasure(player._id, oneColliderFail.bId);
        let bullet = cache.bulletData(player._id, oneColliderFail.bId, false);
        let res;

        isWeapon = (!!wp);
        // 防止多送八豬卡碰撞
        if (bullet && bullet.level == consts.FishType.BAZOOKA) {
            if (!isWeapon) {
                logger.warn('[collider][tryColliderAsync] 機關炮被判定不是特殊武器, playerId: %s, bullet: %s, wp: ', player._id, JSON.stringify(bullet), wp);
            }
            let bazooka = cache.getBazookaAlive(player._id, bullet.cost);
            if (!bazooka || bazooka.alive <= 0) {
                // bazooka alive cache 被刪除時，補救方法。
                if (!!wp && wp.level == consts.FishType.BAZOOKA && wp.alive > 0) {
                    bazooka = self.app.controllers.bullet.setBazookaAlive(wp.playerId, wp.gameId, wp.cost, wp.alive);
                } else {
                    logger.warn('[collider][tryColliderAsync] 超送, playerId: %s, bullet: %s, wp: %s, bazooka: ', player._id, JSON.stringify(bullet), JSON.stringify(wp), bazooka);
                    isWeapon = false;
                }
            }
        }
        // 防止多送 鑽頭&雷射&炸彈蟹&連環炸彈蟹 碰撞
        else if (isWeapon && (wp.level == consts.FishType.DRILL || wp.level == consts.FishType.LASER || wp.level == consts.FishType.BOMB_CRAB || wp.level == consts.FishType.SERIAL_BOMB_CRAB)) {
            if (wp.alive <= 0) {
                // self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, consts.KickUserReason.WeaponNotExist);
                self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.PLAYER_WEAPON_NOT_EXIST);
                return {error: C.PLAYER_WEAPON_NOT_EXIST};
            }
        }
        // debug 用
        let debugData = {"killFirst": oneColliderFail.killFirst, "noDieFirst": oneColliderFail.noDieFirst};
        if (isWeapon) {
            res = yield self._weaponColliderAsync(player, bullet, oneColliderFail.bId, oneColliderFail.hitFishes, oneColliderFail.angles, wp, wp.level, debugData, gameServerId, betSetting);
        } else if (!!bullet) {
            res = yield self._bulletColliderAsync(player, oneColliderFail.bId, oneColliderFail.hitFishes, oneColliderFail.angles, isRetry, debugData, gameServerId, betSetting, extraBetTime);
        } else {
            logger.warn('[collider][checkBulletsAsync] oneColliderFail: %s, isRetry: %s', JSON.stringify(oneColliderFail), isRetry);

            if (COMEUPANCE) {
                try {
                    /*沒有子彈Id快取但收到碰撞事件，有可能是:
                    *  1. 開火封包慢於碰撞封包
                    *  2. 單純惡意封包，沒有開火封包
                    * 若要照樣扣款，有可能遇到：
                    *  1. 開火風暴送到後，因為碰撞已處理導致子彈累積在cache，最後變MAX_BULLET，但斷線時未碰撞的子彈不會真的扣款所以帳務不會錯
                    *  2. 前端送兩次同子彈Id的碰撞
                    *  3. 還沒想到
                    */

                    // 玩家Id
                    let playerId = player._id;
                    // 子彈Id
                    let bulletId = oneColliderFail.bId;
                    logger.warn(`[collider][tryColliderAsync] 沒有子彈Id快取但收到碰撞事件，製作一顆新子彈照樣扣款, playerId: ${playerId}, bulletId: ${bulletId}, oneColliderFail:`, JSON.stringify(oneColliderFail));

                    // 取areaPlayer
                    let areaPlayerDao = self.app.controllers.daoMgr.getAreaPlayerDao();
                    let areaPlayer = yield areaPlayerDao.findOneAsync(player.areaId, player._id, true, gameServerId);
                    // 取該房間最低押注
                    let cost = betSetting.info.levels[player.tableLevel].cannon.cost[0];
                    // 取錢包快取
                    let memWallet = yield self.app.controllers.walletMgr.getWalletAsync(playerId, player.gameId);
                    // 取扣款前餘額
                    let beforeBalance = memWallet.getRealBalance();
                    // 計算快取餘額
                    let betRes = memWallet.bet(Math.abs(cost));
                    if (!betRes) {
                        logger.warn('[onFire][tryColliderAsync][memWallet.bet] ', JSON.stringify({
                            playerId: player._id,
                            areaId: player.areaId,
                            params: oneColliderFail,
                            cost: cost,
                        }));
                        return {error: C.PLAYER_OUT_GOLD};
                    }
                    // 一般子彈level都是undefined
                    let level = undefined;
                    // 指定碰撞對象
                    let lockId = oneColliderFail.hitFishes[0] || undefined;

                    // 製作子彈Data
                    let bulletData = { // bulletHistory: 存子單的資料
                        createTime: utils.timeConvert(Date.now()),
                        areaId: player.areaId,
                        playerId: playerId,
                        bulletId: bulletId,
                        cost:           /*res.score*/betRes.score,            //碰撞沒有帶資料，需額外處理
                        lockTargetId:   /*params.lockId*/lockId,              //碰撞沒有帶資料，需額外處理
                        chairId: areaPlayer.chairId,                   //碰撞沒有帶資料，需額外處理
                        alive: 1,                                    //碰撞沒有帶資料，需額外處理
                        denom:          /*res.ratio*/betRes.ratio,            //碰撞沒有帶資料，需額外處理
                        shootType: _.isString(level) ? level : 'normal',  //碰撞沒有帶資料，需額外處理
                        level: level,                                //碰撞沒有帶資料，需額外處理
                        gameId: player.gameId,                        //碰撞沒有帶資料，需額外處理
                        cash:           /*res.cash*/betRes.cash               //碰撞沒有帶資料，需額外處理
                    };

                    bullet = self.app.controllers.fishHunterCache.bulletSpawn(playerId, _.cloneDeep(bulletData));
                    if (!bullet) throw ('子彈生成失敗');
                    //新增一個飛行中的子彈
                    let insertId = yield self.app.controllers.bullet.AddFlyingBullet(bulletData);
                    if (!insertId) throw ('飛行子彈生成失敗');

                    let creditAmount = memWallet.getRealBalance();//yield self.app.controllers.fishHunterPlayer.getCreditAmount(data.tokens, player.isSingleWallet);
                    // 送更新餘額給前端
                    self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_BALANCE, {
                        pid: playerId,
                        balance: memWallet.getRealTokens()
                    }, false);

                    // 設定子彈為發射完成(已扣完錢)的狀態
                    yield self.app.controllers.bullet.setFireComplete(insertId, bulletId, beforeBalance, creditAmount, playerId);

                    // 試玩帳號 押注 不進rc統計
                    if (!player.demo)
                        self.app.controllers.fishHunterRC.addRecord(player.currency, player.gameId, player.tableLevel, Math.abs(cost), self.app.controllers.fishHunterRC.RC_EVENT.COST, player.dc, betSetting.exchangeRate);

                    res = yield self._bulletColliderAsync(player, oneColliderFail.bId, oneColliderFail.hitFishes, oneColliderFail.angles, isRetry, {
                        "killFirst": oneColliderFail.killFirst,
                        "noDieFirst": oneColliderFail.noDieFirst
                    }, gameServerId, betSetting);

                    logger.warn(`[collider][tryColliderAsync] 沒有子彈Id快取但收到碰撞事件，製作一顆新子彈照樣扣款 完成, playerId: ${playerId}, bulletId: ${bulletId}, oneColliderFail:`, JSON.stringify(oneColliderFail));
                } catch (err) {
                    logger.warn(`[collider][tryColliderAsync][catch] 沒有子彈Id快取但收到碰撞事件，製作一顆新子彈照樣扣款 playerId: ${player._id}, bulletId: ${oneColliderFail.bId}, oneColliderFail: ${JSON.stringify(oneColliderFail)}, err:`, err);
                    self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.PLAYER_BULLETID_NOT_EXIST);
                    return {error: C.PLAYER_BULLETID_NOT_EXIST};
                }
            }
        }

        // if (res) {
        //   if (res.error == C.FISH_COLLIDER_NO_VOUCHER) {
        //     logger.error('[collider][tryColliderAsync] playerId: %s, count: %s, bulletId: ', oneColliderFail.player._id, count, oneColliderFail.bId);
        //     count++;
        //     // 改用memWallet後就不該再出現NO_VOUCHER的錯誤了
        //     // setTimeout(() => {
        //     //   self.tryColliderAsync(oneColliderFail, isRetry, count, gameServerId);
        //     // }, 1000);
        //   } else {
        //     logger.error('[collider][tryColliderAsync][checkBulletsAsync] Fail, oneColliderFail: %s', JSON.stringify(oneColliderFail));
        //   }
        // } else {
        //   return res;
        // }
    } catch (err) {
        logger.error('[collider][tryColliderAsync] oneColliderFail: %s, , err: ', JSON.stringify(oneColliderFail), err);
    }
})

proto._bulletColliderAsync = cort(function* (player, bId, hitFishes, angles, isRetry, debugData, gameServerId, betSetting, extraBetTime) {
    // 驗證耗時用
    let dt = 0;
    if (m_bShowTimeGap) dt = Date.now();
    try {
        let self = this;
        let rpc = self.app.rpc.fishHunter.areaRemote;
        let cache = self.app.controllers.fishHunterCache;
        let killFirst = debugData.killFirst;
        let noDieFirst = debugData.noDieFirst;
        let funName = `playerId: ${player._id}, gameId: ${player.gameId} [_bulletColliderAsync]`;

        let resBullet = cache.bulletData(player._id, bId, false);
        // let vExist = cache.voucherExist(player._id, bId, false);

        if (!resBullet) {
            // 有子彈cache但找不到憑證
            // if (resBullet) {
            //     // 第一次
            //     if (!isRetry) {
            //         return {error: C.FISH_COLLIDER_NO_VOUCHER};
            //     } else {
            //         let data = { playerId: player._id, level: resBullet.level};
            //         self.app.controllers.fishHunterPlayer.pushAsync(player._id, consts.route.client.game.COLLIDER_FAIL, data, false);
            //     }
            // }

            self.app.controllers.debug.info('warn', '_bulletColliderAsync', {
                playerId: player._id,
                bulletId: bId,
                hitFishes: hitFishes,
                resBullet: resBullet,
                // vExist:     vExist,
                reason: 'resBullet_or_vExist_notExist'
            });
            //for碰撞時遇到還沒扣款的憑證 但已經來碰撞的子彈
            //=>先刪除cache的子彈但不處理憑證部分,憑證等離場時再由voucher.refound判斷是否退款
            const response = cache.DestroyBullet(player._id, bId);
            //response=false:代表cache中也沒有這發子彈=>惡意傳訊號來直接問碰撞的
            // return {error: null, data: {}};
            if (!response) {
                self.app.controllers.debug.info('warn', '_bulletColliderAsync', {
                    playerId: player._id,
                    bulletId: bId,
                    hitFishes: hitFishes,
                    resBullet: resBullet,
                    // vExist:     vExist,
                    response: response,
                    reason: '沒有這個子彈的憑證跑來碰撞'
                });
            }
            return {error: null, data: {}};
        }
        cache.bulletSuspend(player._id, resBullet);

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 1); // 驗證耗時用

        rpc.colliderHandler.toServer(
            gameServerId,
            player,
            resBullet,
            hitFishes,
            angles,
            {killFirst, noDieFirst},
            betSetting,
            extraBetTime,
            null,
            cort(function* (err, res) {

                if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 2, 500); // 驗證耗時用

                if (!err && !!res && !res.error) {
                    self.app.memdb.goose.transactionAsync(cort(function* () {
                        yield self._onColliderSettlement(res.data, player.tableLevel, player, killFirst, betSetting, extraBetTime);

                        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 3, 200); // 驗證耗時用
                    }), self.app.getServerId())
                        .catch(err => {
                            logger.error(`[collider][_bulletColliderAsync][_onColliderSettlement.callback] playerId: ${player._id}, bulletId: ${bId}, gameServerId: ${gameServerId}, err:`, err);
                        })

                } else {
                    // 漁場不存在，改印 warn
                    if (res.error == C.FISH_AREA_HAS_COMPLETED) {
                        logger.warn(`[collider][_bulletColliderAsync] playerId: ${player._id}, bulletId: ${bId}, gameServerId: ${gameServerId}, res: ${JSON.stringify(res)} err:`, err);
                    } else {
                        self.app.controllers.debug.info('error', '_bulletColliderAsync', {
                            gameServerId: gameServerId,
                            player: player,
                            bulletId: bId,
                            colliderHandlerRPC_err: err,
                            res: res
                        });
                    }
                }
            }));
    } catch (err) {
        logger.error('[collider][_bulletColliderAsync] player: %s, gameServerId: %s, bulletId: %s, hitFishes: %s, err: ',
            JSON.stringify(player), gameServerId, bId, hitFishes, err);
    }
});

proto._weaponColliderAsync = cort(function* (player, bullet, bId, hitFishes, angles, weaponTypeObj, weaponType, debugData, gameServerId, betSetting) {
    // 驗證耗時用
    let dt = 0;
    if (m_bShowTimeGap) dt = Date.now();
    try {
        let self = this;
        let rpc = self.app.rpc.fishHunter.areaRemote;
        let playerId = player._id;
        let cache = self.app.controllers.fishHunterCache;
        let killFirst = debugData.killFirst;
        let noDieFirst = debugData.noDieFirst;
        let funName = `playerId: ${player._id}, gameId: ${player.gameId} [_weaponColliderAsync]`;

        if (!weaponTypeObj) {
            self.app.controllers.debug.info('error', '_weaponColliderAsync', {
                playerId: playerId,
                bulletId: bId,
                weaponTypeObj: weaponTypeObj,
                weaponType: weaponType,
                reason: 'weaponTypeObj not exist',
            });
            // return;
            return {error: null, data: {}};
        }

        let bazooka = null;
        if (weaponType === consts.FishType.BAZOOKA) {
            cache.DestroyBullet(playerId, bId); // 刪除飛行中的 bullet cache
            bazooka = cache.getBazookaAlive(playerId, weaponTypeObj.cost); // 取: 機關炮碰撞剩餘子彈數
            if (!bazooka) {
                logger.warn(`[collider][_weaponColliderAsync] playerId: ${playerId}, weaponTypeObj: ${JSON.stringify(weaponTypeObj)} bazooka is`, bazooka);
                return;
            }
            player.wId = bullet.sourceWid; // 讓 bazooka 獲得 bazooka 時，存入的來源 wId 是最原先獲得 bazooka 的 wId
            weaponTypeObj.alive = bazooka.alive;
            cache.delTreasure(playerId, bId); // 刪除 Treasure cache
        }

        if (weaponTypeObj.alive <= 0) {
            self.app.controllers.debug.info('error', '_weaponColliderAsync', {
                playerId: playerId,
                bulletId: bId,
                weaponType: weaponType,
                reason: 'weaponTypeObj.alive(' + weaponTypeObj.alive + ') <= 0',
            });
            self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.PLAYER_WEAPON_NOT_ENOUGH);
            return {error: null, data: {}};
        }
        if (weaponTypeObj.alive - hitFishes.length < 0) {
            self.app.controllers.debug.info('error', '_weaponColliderAsync', {
                playerId: playerId,
                bulletId: bId,
                weaponType: weaponType,
                hitFishes: hitFishes,
                reason: 'Collider over max=weaponTypeObj.alive(' + weaponTypeObj.alive + ') - hitFishes.length(' + hitFishes.length + ') < 0',
            });
            hitFishes = hitFishes.slice(0, weaponTypeObj.alive - hitFishes.length);
        }

        let weaponData = _.cloneDeep(weaponTypeObj); // 複製武器資訊, 子單需一筆一筆扣除alive
        weaponTypeObj.alive -= hitFishes.length;
        let bomb = weaponTypeObj.alive <= 0;

        if (bazooka !== null) {
            bazooka.alive -= hitFishes.length;
            weaponData.alive = weaponTypeObj.alive; // 更新: 機關炮碰撞剩餘子彈數
        }

        if (weaponTypeObj.alive <= 0 && !bazooka) {
            this.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.BULLET_BOMB, {
                alive: weaponTypeObj.alive,
                bulletId: weaponTypeObj.bulletId,
                chairId: weaponTypeObj.chairId,
                cost: weaponTypeObj.cost,
                level: weaponTypeObj.level,
                lockTargetId: weaponTypeObj.lockTargetId,
                playerId: weaponTypeObj.playerId,
            }, false);
        }

        // billSucc: 尚未回來=false, 回來但扣款失敗=null
        let billSucc = cache.getBetResult(playerId, weaponTypeObj.getBulletId); // 扣款成功 or 失敗
        let hasResult = cache.hasBetResult(playerId, weaponTypeObj.getBulletId); // 收到 betAndWin

        let forceNoDie = false;
        if (billSucc) { // 扣款成功

        } else {
            logger.warn(`[collider][_weaponColliderAsync] player: ${playerId}, billSucc: ${billSucc}, hasResult:${hasResult}, weaponTypeObj: ${JSON.stringify(weaponTypeObj)}`);
            if (hasResult) {
                // 扣款失敗 && betResult 有回來 // 限制賠付

                // 免費子彈數量(actualAlive) - 碰撞的魚數量(hitFishes.length)
                if (bazooka) bazooka.actualAlive -= hitFishes.length;
                else weaponTypeObj.actualAlive -= hitFishes.length;
                // 處理免費子彈使用完畢
                if (bomb) self.handleWeaponBomb(player, weaponTypeObj, bazooka);
                return;
            } else {

                // 有可能 扣款成功 or 失敗 && betResult 沒回來 // 限制賠付
                forceNoDie = true;
            }
        }

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 1); // 驗證耗時用

        rpc.colliderHandler.toServer(gameServerId, player, weaponData, hitFishes, angles, {
            killFirst,
            noDieFirst
        }, betSetting, null, forceNoDie, cort(function* (err, res) {

            if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 2, 500); // 驗證耗時用

            if (!err && !!res && !res.error) {
                self.app.memdb.goose.transactionAsync(cort(function* () {

                    yield self._onExWeaponColliderSettlement(res.data, bomb, player.tableLevel, player, {
                        killFirst,
                        noDieFirst
                    }, betSetting);

                    if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 3, 200); // 驗證耗時用

                }), self.app.getServerId())
                    .catch(err => {
                        self.app.controllers.debug.info('error', '_weaponColliderAsync._onExWeaponColliderSettlement.CatchErr', {
                            playerId: playerId,
                            bulletId: bId,
                            weaponType: weaponType,
                            err: err,
                            res: res,
                        });
                    })
            } else {
                self.app.controllers.debug.info('error', '_weaponColliderAsync.colliderHandler.rpccallbackCatchErr', {
                    playerId: playerId,
                    bulletId: bId,
                    weaponType: weaponType,
                    weaponTypeObj: weaponTypeObj,
                    err: err,
                    res: res,
                });
            }
        }));
    } catch (err) {
        logger.error('[collider][_weaponColliderAsync] player: %s, bulletId: %s, hitFishes: %s, weaponObj: %s, err: ',
            JSON.stringify(player), bId, hitFishes, JSON.stringify(weaponTypeObj), err);
    }
});

// proto._onKillFishCheck = cort(function*(player, bullet, fishes, angles, killFirst, betSetting) {
//   try {
//     let self = this;
//     let areaId = player.areaId; //讀取房間ID
//     let modelArea = this.app.models.FishHunterArea; //讀取房間Schema
//     let area = yield modelArea.findByIdReadOnlyAsync(areaId);
//     if (!area) {
//       self.app.controllers.debug.info('error', '_onKillFishCheck', {
//         player: player,
//         bulletId: bullet.bulletId,
//         fishes: fishes,
//         reason: 'area not exist',
//       });
//       return {error: C.FISH_AREA_HAS_COMPLETED};
//     }
//
//     let playerId = player._id;
//     const gameId = area.gameId;
//     const tableLevel = area.tableLevel;
//     const scene = area.scene;
//     const fishTypeConfig = self.app.controllers.fishHunterConfig.getFishTypeConfig(gameId);
//     const fishHunterConfig = self.app.controllers.fishHunterConfig.getGameConfig(gameId, tableLevel);
//     const treasureList = fishHunterConfig.treasureList;
//     const fishScore = self.app.controllers.fishHunterConfig.getFishScoreConfig(gameId);
//
//     let gain = 0;
//     let result = [];
//     fishes.sort((l, r) => {
//       return l - r
//     });
//     if (!!angles)
//       angles.sort((l, r) => {
//         return l - r
//       });
//
//     let areaConfig = self.app.controllers.fishHunterConfig.getFishAreaConfig(gameId, tableLevel, scene);
//
//     for (let j = 0; j < fishes.length; j++) {
//       let res = {
//         bid: bullet.bulletId, chairId: bullet.chairId, success: false, die: false, cost: bullet.cost,
//         fids: [], ftypes: [], score: [], typeBombs: [], treasure: [],
//         totalBonus: 0,           // 計算當下的總倍數
//         income: 0,              // 總贏分
//         angle: undefined,       // 雷射武器同步角度用
//         fishRealType: "",       // 存放鱼的原始型态
//         reincarnation: "",      // [新增]再生變形功能:被打死後再生狀態變成哪種魚
//         OnKillDisappear: true,  // 預設為每隻魚被殺死都會消失
//         extraChainOdds: 1,      // 額外的賠率(bomb&chain)
//         odds: 0,                // 原始分數(賠率)
//         level: bullet.level,    // 魚被什麼子彈類型擊中(client用)
//         bombTypeList: [],       // 連鎖&炸彈擊中其他魚的type列表
//         avgOdds: 0,             // 平均倍數fishArea_x_x裡score的avg (風控用&機率)
//         fishTemp: {},            // 暫存碰撞目標對象
//         extraBonusOdds: 0,       // 額外觸發的bonus用(倍數)
//       };
//
//
//       let fishTemp = yield self.findOneAreaFishReadOnly(areaId, fishes[j]);
//       if (!fishTemp) {
//         this.app.controllers.debug.info('warn', '_onKillFishCheck', {
//           playerId: playerId,
//           bullet: bullet,
//           fishes: fishes,
//           gameId: gameId,
//           scene: scene,
//           reason: '玩家送不存在的FishId,給他碰撞Fish_000魚'
//         });
//         // 玩家用特殊手法，打到不屬於sever產生的魚時 // 給他碰撞Fish_000魚種 // fishId = 0
//         fishTemp = yield self.findOneAreaFishReadOnly(areaId, 0);
//         // fishes = [fishTemp.id];
//         fishes[j] = fishTemp.id;
//       }
//
//       if (!!angles && !!angles[j]) {
//         res.angle = angles[j];
//       }
//
//       res.avgOdds = fishTemp.score; // 存最原始的賠率 (avg)
//       res.fishTemp = fishTemp;
//       // 取得打到魚的資訊
//       res = yield self.getHitFishDataInfo(fishTemp, treasureList, areaConfig, fishScore, area, res, player);
//
//       if (!res.success) {
//         this.app.controllers.debug.info('error', '_onColliderAsync', {
//           player,
//           bullet,
//           fishes,
//           area,
//           treasureList,
//           fishTemp,
//           config: areaConfig,
//           res
//         });
//       }
//       result.push(res);
//     }
//
//     let rsp = [];
//     for (let idx in result) {
//       res = result[idx];
//       if (!res.success) {
//         rsp.push({res: res, gain: res.income});
//         continue;
//       }
//
//       //第一階段捕獲判定
//       let randomFishesDieRes = this.app.controllers.fishHunterGame.randomFishesDie(res.hitresult, res.totalBonus, tableLevel, bullet.cost, gameId, res.fishRealType, res.fishTemp.state, player, killFirst);
//
//       // 魚種有血量制
//       if (fishTypeConfig.AllFish[res.fishRealType].hpProb) {
//         // 當前血量百分比
//         res.hpPercent = res.fishTemp.getHpPercent();
//
//         // 第一次判定沒死可以再ran一次增加死亡率，若hp為undefined表示要麻沒有血量制、要麻是給特殊封包碰撞的魚(找不到server產生的魚時)無法多ran一次
//         if (utils.randProbability.getRangeHit(0,100, fishTypeConfig.AllFish[res.fishRealType].hpProb) && res.fishTemp.hp != 'undefined' && res.hpPercent <= 0) {
//           randomFishesDieRes = this.app.controllers.fishHunterGame.randomFishesDie(res.hitresult, res.totalBonus, tableLevel, bullet.cost, gameId, res.fishRealType, res.fishTemp.state, player, killFirst);
//           logger.warn('魚種： %s, Id: %s 血量值 = %s%, 執行第二次判定! die = %s', res.fishRealType, res.fishTemp._id, utils.number.multiply(res.hpPercent, 100), randomFishesDieRes.die);
//         }
//
//         // 扣血量
//         if (res.fishTemp.hp) {
//           res.fishTemp.hp -= 1;
//           yield res.fishTemp.saveAsync();
//
//           // 剩餘血量百分比
//           res.hpPercent = res.fishTemp.getHpPercent();
//         }
//       }
//
//       res.die = randomFishesDieRes.die;
//       res.randomConfig = randomFishesDieRes.randomConfig;
//       res.rcCheck = randomFishesDieRes.rcCheck;
//
//       // 風控檢查(幣別贏分上限)
//       if (!killFirst)
//         res = self.app.controllers.subuki.checkSUBUKI_MaxReward(res, player, area, fishScore, treasureList, betSetting);
//
//       // 機關炮不能打死: 鑽頭炮 & 雷射炮
//       if (bullet.level == consts.FishType.BAZOOKA && (res.fishRealType == consts.FishType.DRILL || res.fishRealType == consts.FishType.LASER)) {
//         res.die = false;
//       }
//       // 鑽頭砲、電磁砲不能打死: 幾種特殊武器
//       else if (bullet.level == consts.FishType.DRILL || bullet.level == consts.FishType.LASER) {
//         if (fishHunterConfig.noKilltreasure.indexOf(res.fishRealType) != -1) {
//           res.die = false;
//         }
//       }
//
//       if (res.die) {
//
//         if (typeof(areaConfig.fish.ChangeSceneSet) != "undefined"
//             && typeof(areaConfig.fish.ChangeSceneSet[res.fishRealType]) != "undefined") {
//           // 取得這隻魚 死亡所需表演"死亡動畫"時間的毫秒數
//           let killShowTime = areaConfig.fish.ChangeSceneSet[res.fishRealType].OnKillShow;
//           let rpc = self.app.rpc.fishHunter.areaRemote;
//           // rpc 到 fishHunter 處理 area 轉場時間
//           yield P.promisify(rpc.updateAreaSceneTimeDelay, rpc)(playerId, player.areaId, killShowTime);
//         }
//
//         // 取得不死魚被打死後的變形資料
//         if (fishTemp) // 鞭屍的魚只處理機率不做變形處理
//           res = yield self.getReincarnation(gameId, areaId, fishTemp, fishTypeConfig, res);
//
//         // 該隻魚如果不是不死魚
//         if (res.OnKillDisappear == true) {
//           res.fishTemp.born = 0;
//           yield res.fishTemp.saveAsync();
//         }
//
//         // 定義打死魚後觸發其他bonus
//         res = yield self.getExtraBonus(gameId, res, fishTypeConfig, areaConfig, tableLevel, bullet, player, area, treasureList, killFirst);
//
//         // 處理額外死掉的魚 born = 0
//         if (res.typeBombs.length > 0) {
//           let allFishIds = [];
//           allFishIds = allFishIds.concat(res.fids);
//
//           self.removeAllDeadFishes(areaId, allFishIds, fishes, player.gameServerId);
//
//           res.fids = res.typeBombs;
//         }
//
//         // 集寶器判斷
//         res = yield self.checkLuckyDraw(player, gameId, res, bullet);
//
//         res.income = utils.number.multiply(res.totalBonus, res.cost, res.extraChainOdds);
//       } else {
//         res.fids = fishes;
//         res.score = [];       // bomb&chain: 魚沒死就不傳分數
//         res.typeBombs = [];   // bomb&chain: 魚沒死就不傳打中的其他魚
//         res.bombTypeList = [];// bomb&chain: 魚沒死就不傳打中的其他魚type
//         res.treasure = [];    // 魚沒死不放 treasure
//
//         // 定義沒打中魚時有機會觸發額外Bonus
//         res = self.getNoDieBonus(gameId, res, fishTypeConfig, areaConfig, area, treasureList, tableLevel);
//       }
//       // res.income = utils.number.multiply(res.totalBonus, res.cost, res.extraChainOdds);
//       gain = utils.number.add(gain, res.income);
//       rsp.push({res: res, gain: res.income, scene: scene});  //  回傳data增加scene
//     }
//
//     this.app.controllers.debug.info('info', '_onKillFishCheck', {
//           playerId: player._id,
//           areaId: player.areaId,
//           bulletId: bullet.bulletId,
//           fishes: fishes,
//           rsp: rsp
//         }
//     );
//
//     return {error: null, data: rsp};
//   } catch (err) {
//     logger.error('[collider][_onKillFishCheck] player: %s, bullet: %s, fishes: %s, err: ',
//         JSON.stringify(player), JSON.stringify(bullet), fishes, err);
//   }
// });

// proto.getFishResetInfo = function (res) {
//   try {
//     res.ftypes = [];
//     res.fids = [];
//     res.score = [];
//     res.odds = 0;
//     res.treasure = [];
//     delete res.pauseTime;
//     return res;
//   } catch (err) {
//     logger.error('[collider][getFishResetInfo] res: %s, err: ', JSON.stringify(res), err);
//   }
// };

// 取得打到魚的資訊
// proto.getHitFishDataInfo = cort(function* (fishTemp, treasureList, areaConfig, fishScore, area, res, player) {
//   try {
//     let self = this;
//     let data;
//     let chainAlgConfig;
//
//     switch (fishTemp.state) {
//       case consts.FishState.TEAM:
//         self.getFishDefaultInfo(fishTemp, res, fishScore);
//         return res;
//       case consts.FishState.CHAIN:
//       case consts.FishState.FLASH:
//       case consts.FishState.METEOR:
//       case consts.FishState.FLASH_SHARK:
//       case consts.FishState.WAKEN:
//         // 取額外倍數
//         let fs;
//
//         if (fishTemp.state != consts.FishState.FLASH_SHARK) { // FLASH_SHARK 沒有隨機倍數不用取
//           switch (fishTemp.state) {
//             case consts.FishState.CHAIN:// 連鎖閃電 場上同類必死
//               fs = fishScore[consts.FishType.CHAIN];
//               break;
//             case consts.FishState.FLASH:// 放射閃電 隨機找N隻必死（100倍以下）
//               fs = fishScore[consts.FishType.FLASH];
//               break;
//             case consts.FishState.METEOR:// 流星雨   場上同類必死（100倍以下）
//               fs = fishScore[consts.FishType.METEOR];
//               break;
//             case consts.FishState.WAKEN:// 流星雨   場上同類必死（100倍以下）
//               fs = fishScore[consts.FishType.WAKEN];
//               break;
//             default:
//               logger.error('[getHitFishDataInfo] UNKNOW fishTemp.state');
//               break;
//           }
//           if (!fs)    return res;
//           let randomTable = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod);
//           let randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
//           res.extraChainOdds = randomScore.bonus;
//         }
//
//         // 先取魚本身的倍數
//         self.getFishDefaultInfo(fishTemp, res, fishScore);
//
//         /*== 處理其他連鎖的魚 ==*/
//         chainAlgConfig = this.app.controllers.fishHunterConfig.getChainAlgConfig(area.gameId);
//         switch (fishTemp.state) {
//           case consts.FishState.CHAIN:// 連鎖閃電 場上同類必死
//           case consts.FishState.METEOR:// 流星雨   場上同類必死（100倍以下）
//             data = yield self.getMustDieFishesByChain(area, fishTemp, res.extraChainOdds, res.cost, fishScore, (fishTemp.state == consts.FishState.CHAIN), chainAlgConfig);
//             break;
//           case consts.FishState.FLASH:// 放射閃電 隨機找N隻必死（100倍以下）
//             data = yield self.getMustDieFishesByFlash(area, fishTemp, res.extraChainOdds, res.cost, fishScore, chainAlgConfig);
//             break;
//           case consts.FishState.FLASH_SHARK:// 閃電魚   隨機找N隻必死（100倍以下）
//             data = yield self.getMustDieFishesByFlash(area, fishTemp, 1, res.cost, fishScore, chainAlgConfig);
//             break;
//           case consts.FishState.WAKEN:// 覺醒 以總分推算捕獲場上魚隻
//             data = yield self.getMustDieFishesByWaken(area, fishTemp, res.extraChainOdds, res.cost, fishScore, chainAlgConfig, res.odds);
//             break;
//         }
//
//         res.typeBombs = res.fids.concat(data.ids);
//         res.fids = res.fids.concat(data.ids);
//         res.score = res.score.concat(data.score);
//         res.bombTypeList = data.typeList; // 連鎖擊中其他魚的type列表(不含被擊中的那隻)
//         res.totalBonus = utils.number.add(res.totalBonus, data.totalBonus); // 打中那隻加上連鎖擊中其他魚的總倍數
//
//         //計算特殊機率
//         let cache = this.app.controllers.fishHunterCache;
//         let levels = cache.getFishAlgArgs(player, player.tableLevel);
//         // if (!levels) levels = cache.getFishAlgArgs(area.gameId);
//         if (!levels) levels = 'normal';
//         //先抽不同levels的chain_rtp TABLE
//         let randomChainrtpTable = utils.randProbability.getRand( chainAlgConfig.chain_rtp[levels], 'weight', m_objRNGMethod);
//         //再抽不同TABLE的rtp
//         let randomRTP = utils.randProbability.getRand(randomChainrtpTable.vals, 'prob', m_objRNGMethod).rtp;
//         // 計算 hitresult
//         switch (fishTemp.state) {
//           case consts.FishState.CHAIN:// 連鎖閃電 場上同類必死
//           case consts.FishState.METEOR:// 流星雨   場上同類必死（100倍以下）
//           case consts.FishState.WAKEN:// 覺醒 以總分推算捕獲場上魚隻
//             res.hitresult = utils.number.divide(randomRTP, res.totalBonus);
//             break;
//           case consts.FishState.FLASH:// 放射閃電 隨機找N隻必死（100倍以下）
//           case consts.FishState.FLASH_SHARK:// 閃電魚   隨機找N隻必死（100倍以下）
//             let hitrate = utils.number.divide(randomRTP, res.totalBonus);
//             //先抽不同levels的mortalityrate TABLE
//             let randomMortalityrateTable = utils.randProbability.getRand( chainAlgConfig.mortalityrate[levels], 'tabprob', m_objRNGMethod);
//             let randomMortalityrate = utils.randProbability.getRand(randomMortalityrateTable.vals, 'prob', m_objRNGMethod).rate;
//             res.hitresult = utils.number.workMultiply(hitrate, randomMortalityrate);
//             break;
//         }
//         return res;
//       default:
//         self.getFishDefaultInfo(fishTemp, res, fishScore);
//         self.checkTreasure(fishTemp, areaConfig, treasureList, res);
//         return res;
//     }
//   } catch (err) {
//     logger.error('[collider][getHitFishDataInfo] player: %s, res: %s, err: ', JSON.stringify(player), JSON.stringify(res), err);
//   }
// });

// proto.getFishDefaultInfo = function (fishTemp, res, fishScore) {
//   try {
//     res.success = true;
//     res.ftypes.push(fishTemp.type + '|' + fishTemp.state);
//     res.state = fishTemp.state;
//     res.fishRealType = fishTemp.type;
//     res.fids.push(fishTemp.id);
//
//     let fs = fishScore[fishTemp.type];
//     if (!fs) {
//       logger.error('[collider][getFishDefaultInfo] fish score config error ', fishTemp.type, ' config ', fishScore, ' res: ', JSON.stringify(res));
//       return res;
//     }
//     let randomTable = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod);//先抽TABLE
//     let randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
//     let fishBonus = 0;
//     if (!!randomScore) {
//       fishBonus = randomScore.bonus;
//     }
//     res.score.push(utils.number.multiply(fishBonus, res.cost, res.extraChainOdds));
//     res.totalBonus = fishBonus;
//     res.odds = fishBonus; // 存random完的賠率
//
//     return res;
//   } catch (err) {
//     logger.error('[collider][getFishDefaultInfo] fishTemp: %s, res: %s, err: ', JSON.stringify(fishTemp), JSON.stringify(res), err);
//   }
// };

// proto.checkTreasure = function (fishTemp, areaConfig, treasureList, res) {
//   try {
//     if (fishTemp.type == consts.FishType.ICE) { // 冰凍炸彈
//       res.pauseTime = areaConfig.scene.PAUSE_SCREEN_TIME_DELAY || 5000;
//     }
//     else if (treasureList.indexOf(fishTemp.type) !== -1) { // 檢查type是否為 => 武器/轉盤/紅包
//       res.treasure.push(fishTemp.type);
//     }
//     return res;
//   } catch (err) {
//     logger.error('[collider][checkTreasure] fishTemp: %s, res: %s, err: ', JSON.stringify(fishTemp), JSON.stringify(res), err);
//   }
// };

// proto.countFishesByType = cort(function*(area, type, extraChainOdds, cost) {
//     let scoreList = [];
//     let idList = [];
//     let areaId = area._id;
//     let modelAreaFishes = this.app.models.FishHunterAreaFishes;
//     let config = this.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);
//     let totalBonus = 0;
//     // FishArea:areaId:FTypes:type: 目前拔掉了 無法使用
//     let fishId_arr = yield this.app.controllers.redisCache.getRedisMaster().smembers( 'FishArea:'+areaId + ':FTypes:'+ type );
//     let fish = null;
//     let score = 0;
//     let fs = null;
//     let randomTable = null;
//     let randomScore = 0;

//     for (let i = 0; i < fishId_arr.length; i++) {
//         fishId_arr[i] = JSON.parse( fishId_arr[i] );
//         if (fishId_arr[i].dead_at <= Date.now()) {
//             continue;
//         }
//         fish = yield modelAreaFishes.findByIdReadOnlyAsync(areaId + fishId_arr[i].id , '_id id amount score type');
//         if (!!fish && fish.type == type) {
//             score = utils.number.multiply(fish.score, extraChainOdds, cost);
//             scoreList.push(score);
//             idList.push(fish.id);

//             fs = config.fish.score[fish.type];
//             if (!fs) {
//                 logger.error('fish score config error ',fish.type,' config ',config.fish.score);
//             }
//             else {
//                 randomTable = utils.randProbability.getRand(fs.vals,'tabprob');//先抽TABLE
//                 randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob');
//                 if (!!randomScore) {
//                     totalBonus = utils.number.add(totalBonus, randomScore.bonus);
//                 }
//             }
//         }
//     }
//     return {score: scoreList, ids: idList, totalBonus: totalBonus};
// });

// 連鎖閃電 場上同類必死（100倍以下）
// 流星雨 全場必死（100倍以下）
// proto.getMustDieFishesByChain = cort(function* (area, fishTemp, extraChainOdds, cost, fishScore, isSame, chainAlgConfig) {
//   try {
//     let self = this;
//     let scoreList = [];
//     let idList = [];
//     let typeList = [];
//     let areaId = area._id;
//     const hitFishType = fishTemp.type;
//     let modelAreaFishes = self.app.models.FishHunterAreaFishes;
//     let totalBonus = 0;
//
//     // 取場上同種魚
//     // let fishId_arr = yield modelAreaFishes.findAsync({areaId: areaId, type: hitFishType});
//     let searchData = {areaId: areaId};
//     if (isSame) searchData.type = hitFishType;
//     let fishId_arr = yield modelAreaFishes.findAsync(searchData);
//
//     let score = 0;
//     let fs = null;
//     let randomTable = null;
//     let randomScore = 0;
//
//     // 亂數排序
//     fishId_arr = utils.randProbability.randomSort(fishId_arr);
//
//     for (let fish of fishId_arr) {
//       if (fish.born <= 0 || fish.id == 0 || fish.id == fishTemp.id) continue; // 跳過魚已死亡 或 第0隻 或 被擊中的那隻魚
//       if (fish.born + (fish.alive * 1000) < area.updateTime) continue; // 魚存活時間 < 魚場最新時間 = 魚已離開場外
//       if (fish.score > chainAlgConfig.maxOdd) continue;
//       fs = fishScore[fish.type];
//       if (!fs) continue;//logger.error('fish score config error ',fish.type,' fishScore ',fishScore);
//       randomTable = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod);//先抽TABLE
//       randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
//       if (!!randomScore) {
//         totalBonus = utils.number.add(totalBonus, randomScore.bonus);
//         score = utils.number.multiply(randomScore.bonus, extraChainOdds, cost);
//         scoreList.push(score);
//         idList.push(fish.id);
//         typeList.push(fish.type);
//       }
//     }
//     return {score: scoreList, ids: idList, totalBonus: totalBonus, typeList};
//   } catch (err) {
//     logger.error('[collider][getMustDieFishesByChain] fishTemp: %s, extraChainOdds: %s, err: ', JSON.stringify(fishTemp), extraChainOdds, err);
//   }
// });

// 放射閃電 隨機找N隻必死（100倍以下）
// proto.getMustDieFishesByFlash = cort(function* (area, fishTemp, extraChainOdds, cost, fishScore, chainAlgConfig) {
//     try {
//         let self = this;
//         let scoreList = [];
//         let idList = [];
//         let typeList = [];
//         let areaId = area._id;
//         let modelAreaFishes = self.app.models.FishHunterAreaFishes;
//         let totalBonus = 0;
//
//         // 取場上所有魚
//         let fishId_arr = yield modelAreaFishes.findAsync({areaId: areaId});
//
//         let score = 0;
//         let fs = null;
//         let randomTable = null;
//         let randomScore = 0;
//         let Lambda = utils.randProbability.getRand(chainAlgConfig.Lambda, 'weight',m_objRNGMethod);
//         let DieCount = utils.randProbability.getRand(Lambda.vals, 'prob',m_objRNGMethod).count;
//         let count = 0;
//
//         // 亂數排序
//         fishId_arr = utils.randProbability.randomSort(fishId_arr);
//
//         for (let fish of fishId_arr) {
//             if (fish.born <= 0 || fish.id == 0 || fish.id == fishTemp.id) continue; // 跳過魚已死亡 或 第0隻 或 被擊中的那隻魚
//             if (fish.born + (fish.alive * 1000) < area.updateTime) continue; // 魚存活時間 < 魚場最新時間 = 魚已離開場外
//             if (fish.score > chainAlgConfig.maxOdd) continue;
//             if (count >= DieCount) break;
//             fs = fishScore[fish.type];
//             if (!fs) continue;//logger.error('fish score config error ',fish.type,' fishScore ',fishScore);
//             count++;
//             randomTable = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod);//先抽TABLE
//             randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
//             if (!!randomScore) {
//               totalBonus = utils.number.add(totalBonus, randomScore.bonus);
//               score = utils.number.multiply(randomScore.bonus, extraChainOdds, cost);
//               scoreList.push(score);
//               idList.push(fish.id);
//               typeList.push(fish.type);
//             }
//         }
//         return {score: scoreList, ids: idList, totalBonus: totalBonus, typeList};
//     } catch (err) {
//         logger.error('[collider][getMustDieFishesByChain] fishTemp: %s, extraChainOdds: %s, err: ', JSON.stringify(fishTemp), extraChainOdds, err);
//     }
// });

// 覺醒 以總分推算捕獲場上魚隻
// proto.getMustDieFishesByWaken = cort(function* (area, fishTemp, extraChainOdds, cost, fishScore, chainAlgConfig, hitFishOdds) {
//   try {
//     let self = this;
//     let scoreList = [];
//     let idList = [];
//     let typeList = [];
//     let areaId = area._id;
//     let modelAreaFishes = self.app.models.FishHunterAreaFishes;
//     let totalBonus = utils.number.multiply(hitFishOdds, extraChainOdds, cost);
//
//     // 取場上所有魚
//     let fishId_arr = yield modelAreaFishes.findAsync({areaId: areaId});
//
//     let score = 0;
//     let fs = null;
//     let randomTable = null;
//     let randomScore = 0;
//
//     // 表演死亡數取場上一半就好
//     let DieCount = Math.floor(utils.number.multiply(fishId_arr.length, 2));
//     let count = 0;
//
//     // 亂數排序
//     fishId_arr = utils.randProbability.randomSort(fishId_arr);
//
//     for (let fish of fishId_arr) {
//       if (fish.born <= 0 || fish.id == 0 || fish.id == fishTemp.id) continue; // 跳過魚已死亡 或 第0隻 或 被擊中的那隻魚
//       if (fish.born + (fish.alive * 1000) < area.updateTime) continue; // 魚存活時間 < 魚場最新時間 = 魚已離開場外
//       if (fish.score > chainAlgConfig.maxOdd) continue;
//       if (count >= DieCount) break;
//       fs = fishScore[fish.type];
//       if (!fs) continue;//logger.error('fish score config error ',fish.type,' fishScore ',fishScore);
//       randomTable = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod);//先抽TABLE
//       randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
//       if (!!randomScore) {
//         score = utils.number.multiply(randomScore.bonus, cost);
//         if (totalBonus < score) break;
//         totalBonus -= score;
//         count++;
//
//         scoreList.push(score);
//         idList.push(fish.id);
//         typeList.push(fish.type);
//       }
//     }
//     return {score: scoreList, ids: idList, totalBonus: 0, typeList};
//   } catch (err) {
//     logger.error('[collider][getMustDieFishesByWaken] fishTemp: %s, extraChainOdds: %s, err: ', JSON.stringify(fishTemp), extraChainOdds, err);
//   }
// });

// 取得魚被打死後的變身資料
// proto.getReincarnation = cort(function* (gameId, areaId, fishTemp, fishTypeConfig, res) {
//   try {
//     let self = this;
//     let ret = fishTypeConfig.AllFish[fishTemp.type].OnKillDisappear; // 取設定檔該隻魚設定為不死魚
//     if ( ret == false ){
//       res.OnKillDisappear = false;//設定為被殺後不消失=不死魚
//       //取設定檔，取看看該魚種有沒有設定變身 有的話回傳給前端 功能用途舉例: "五龍1"打死後魚種變成"五龍2"
//       // let getReincarnationStatus = fishTypeConfig.AllFish[fishTemp.type].reincarnation;
//       let getReincarnationStatus;
//       if (fishTypeConfig.AllFish[fishTemp.type].reincarnation) {
//         // 沒有reincarnationProb 或 觸發reincarnationProb 就變身
//         if (!fishTypeConfig.AllFish[fishTemp.type].reincarnationProb
//             || fishTypeConfig.AllFish[fishTemp.type].reincarnationProb <= 0
//             || utils.randProbability.getRangeHit(0,100, fishTypeConfig.AllFish[fishTemp.type].reincarnationProb)) {
//           getReincarnationStatus = fishTypeConfig.AllFish[fishTemp.type].reincarnation;
//         }
//       }
//       res.reincarnation = "";
//       if (typeof(getReincarnationStatus) == "string" ){
//         res.reincarnation = getReincarnationStatus;
//         //在AreaFish将该鱼变更Type 成 reincarnation新的Type
//         yield self.updateAreaFish(areaId, fishTemp.id, {type: getReincarnationStatus});
//       }
//     }
//     return res;
//   } catch (err) {
//     logger.error('[collider][getReincarnation] res: %s, err: ', JSON.stringify(res), err);
//   }
// });

// 定義打死魚後觸發其他bonus // 10002、10003的fishType.json
// 不支援打死bonus後觸發其他bonus
// proto.getExtraBonus = cort(function* (gameId, res, fishTypeConfig, areaConfig, tableLevel, bullet, player, area, treasureList, killFirst) {
//   try {
//     // 風控檢查(未捕獲觸發或額外觸發)
//     if (!this.app.controllers.subuki.checkSUBUKI_ExtraTrigger(res, gameId) && !killFirst)
//       return res;
//
//     //取得该鱼是否有触发bomus 如:触发drill子弹
//     let fishType = res.fishRealType;
//     let extraBonus = fishTypeConfig.AllFish[fishType].extraBonus;
//     if (extraBonus){
//       let extraBonusAlgConf = this.app.controllers.fishHunterConfig.getExtraBonusAlgConfig(gameId);
//
//       //先抽有沒有觸發
//       let randomResult = utils.randProbability.getRand(extraBonusAlgConf.extraBonus,'triggerprob', m_objRNGMethod);
//
//       //擋測試模式才可使用
//       if (killFirst)
//         if (this.app.get('env') == 'development') {
//           while (!randomResult || !randomResult.tabvals || randomResult.tabvals.length <= 0) {
//             randomResult = utils.randProbability.getRand(extraBonusAlgConf.extraBonus,'triggerprob', m_objRNGMethod);
//           }
//         }
//
//       if (randomResult != null && randomResult.tabvals && randomResult.tabvals.length > 0) {
//         //抽要觸發哪種bonus
//         randomResult = utils.randProbability.getRand(randomResult.tabvals,'triggerprob', m_objRNGMethod);
//
//         //擋測試模式才可使用
//         if (killFirst)
//           if (this.app.get('env') == 'development') {
//             while (!randomResult || !randomResult.bonusType || !randomResult.val) {
//               randomResult = utils.randProbability.getRand(randomResult.tabvals,'triggerprob', m_objRNGMethod);
//             }
//           }
//
//         if (randomResult != null && randomResult.bonusType && randomResult.val) {
//           let bonusType = randomResult.bonusType;
//           let cache = this.app.controllers.fishHunterCache;
//           let levels = cache.getFishAlgArgs(gameId, tableLevel);
//           if (!levels) levels = cache.getFishAlgArgs(gameId);
//           if (!levels) levels = cache.getFishAlgArgs();
//
//           //抽要哪個level的TABLE
//           let randomTable = utils.randProbability.getRand(randomResult.val[levels],'tabprob', m_objRNGMethod);
//           if (randomTable) {
//             //抽倍數結果
//             randomTable = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
//             let randomScore = randomTable.val;
//
//             res.treasure.push(bonusType);
//             res.extraBonusOdds = randomScore;
//             logger.info('[collider][getExtraBonus] trigger ExtraBonus!!!!! res: ', res);
//           }
//         }
//       }
//     }
//     return res;
//   } catch (err) {
//     logger.error('[collider][getExtraBonus] res: %s, err : ', JSON.stringify(res), err);
//   }
// });

// 檢查打死魚後是否獲得集寶器搜集物件
// proto.checkLuckyDraw = cort(function*(player, gameId, res, bullet) {
//   try {
//     let self = this;
//     let collectionDrawConfig = self.app.controllers.fishHunterConfig.getCollectionDrawConfig(gameId);
//
//     // 有無config
//     if (collectionDrawConfig) {
//
//       // 是否為可收集的魚種
//       if (collectionDrawConfig.collectionType.indexOf(res.fishRealType) > -1) {
//
//         // 取集寶器紀錄
//         let modelCollection = self.app.models.CollectionHistory;
//         let collectionId = modelCollection.getId(player._id, player.gameId);
//         let collection = yield modelCollection.findByIdAsync(collectionId);
//
//         // 檢查收集紀錄
//         if (!collection) {
//           collection = new modelCollection({
//             _id: collectionId,
//             playerId: player._id,
//             gameId: player.gameId,
//             bulletId: bullet.bulletId,
//             cost: bullet.cost,
//             shootType: bullet.shootType,
//           });
//         }
//
//         // 增加次數
//         collection.count += 1;
//         // 紀錄子彈Id
//         collection.bulletId = bullet.bulletId;
//         // 更新 cost
//         collection.cost = bullet.cost;
//         // 更新武器種類
//         collection.shootType = bullet.shootType;
//
//         res.luckyDraw = {       // 幸運抽獎
//           trigger: false,  // 是否觸發
//           count: 0,      // 進度
//           fixedOdds: 0,      // 固定倍數
//         };
//
//         // 是否集滿
//         if (collection.count < collectionDrawConfig.collectionCount) {
//           // 未集滿
//           res.luckyDraw.count = collection.count;
//           delete res.luckyDraw.fixedOdds;
//         } else {
//           // 集滿(超過吃掉)
//           res.luckyDraw.trigger = true;
//           collection.count = collectionDrawConfig.collectionCount;
//           res.luckyDraw.count = collection.count;
//           res.luckyDraw.fixedOdds = collectionDrawConfig.collectionAvgOdds;
//
//           let cache = this.app.controllers.fishHunterCache;
//           let levels = cache.getFishAlgArgs(gameId, player.tableLevel);
//           if (!levels) levels = cache.getFishAlgArgs(gameId);
//           if (!levels) levels = cache.getFishAlgArgs();
//           collection.levels = levels;
//         }
//         yield collection.saveAsync();
//       }
//     }
//     return res;
//   } catch (err) {
//     logger.error('[collider][checkLuckyDraw] player: %s, gameId: %s, res: %s, bullet: %s, err : ', JSON.stringify(player), gameId, JSON.stringify(res), JSON.stringify(bullet), err);
//   }
// });

// 定義沒打中魚時有機會觸發額外Bonus
// proto.getNoDieBonus = function (gameId, res, fishTypeConfig, areaConfig, area, treasureList, tableLevel) {
//   try {
//     // 風控檢查(未捕獲觸發或額外觸發)
//     if (!this.app.controllers.subuki.checkSUBUKI_ExtraTrigger(res, gameId))
//       return res;
//
//     let noDieBonusId = fishTypeConfig.NoDieBonus;
//     if (res.randomConfig.noDie && noDieBonusId){
//       //先抽有沒有中
//       let counter = 10000000;
//       let prob = res.randomConfig.noDie[0].prob * counter;
//       prob = _.round(prob,0);
//       let alive = utils.number.sub(counter, prob);
//       if (alive < 0)  alive = 0;
//       let arr = [
//         {"prob":prob,result:1},
//         {"prob":alive,result:0}
//       ];
//       let ranRes = utils.randProbability.getRand(arr,'prob', m_objRNGMethod);
//       if (ranRes.result > 0) {
//         //觸發
//
//         //先抽TABLE
//         let randomTable = utils.randProbability.getRand(res.randomConfig.noDie[0].pay,'weight', m_objRNGMethod);
//         let randomScore = randomTable.val;
//
//         res.treasure.push(noDieBonusId);
//         res.extraBonusOdds = randomScore;
//         logger.info('[collider][getNoDieBonus] trigger NoDieBonus!!!!! res: ', res);
//       }
//     }
//     return res;
//   } catch (err) {
//     logger.error('[collider][getNoDieBonus] res: %s, err : ', JSON.stringify(res), err);
//   }
// }

// proto.removeAllDeadFishes = cort(function*(areaId, deadFishes, exceptFishes, shardId) {
//   let self = this;
//
//   return self.app.memdb.goose.transactionAsync(cort(function*() {
//     for (let i = 0; i < deadFishes.length; i++) {
//       for (let j = 0; j < exceptFishes.length; j++) {
//         if (deadFishes[i] == exceptFishes[j] && deadFishes[i] != 0) {
//           deadFishes[i] = 0;
//         }
//       }
//     }
//
//     deadFishes.sort((l, r) => {
//       return l - r
//     });
//
//     for (let i = 0; i < deadFishes.length; i++) {
//       if (deadFishes[i] != 0) {
//         let bSuccess = yield self.updateAreaFish(areaId, deadFishes[i], {born: 0});
//
//         if (!bSuccess) {
//           //logger.error('removeAllDeadAreaFish error ', areaId, ' fishId ', deadFishes[idx]);
//         }
//       }
//     }
//
//   }), shardId)
//   .then(() => {
//     self.app.event.emit('transactionSuccess')
//   })
//   .catch((err) => {
//     logger.error('[collider][removeAllDeadFishes] deadFishes: %s, err: ', JSON.stringify(deadFishes), err);
//     self.app.event.emit('transactionFail');
//   });
// });

// proto.updateAreaFish = cort(function*(areaId, fishId, opts) {
//   try {
//     let temp = yield this.app.models.FishHunterAreaFishes.findByIdAsync(areaId + fishId);
//     if (!!temp) {
//       for (let o in opts) {
//         temp[o] = opts[o];
//       }
//       yield temp.saveAsync();
//     }
//
//     return temp;
//   } catch (err) {
//     logger.error('[collider][updateAreaFish] areaId: %s, fishData: %s, err: ', areaId, JSON.stringify(opts), err);
//   }
// });

// proto.checkScreenPause = cort(function*(result, player) {
//   try {
//     for (let idx in result.data) {
//       let res = result.data[idx].res;
//
//       if (res.die) {
//         if (!res.pauseTime) {
//           continue;
//         }
//
//         yield this.screenPause(player.areaId, res.pauseTime, player.gameServerId);
//
//         break;
//       }
//     }
//
//     return result;
//   } catch (err) {
//     logger.error('[collider][checkScreenPause] playerId: %s, result: %s, err: ', player._id, JSON.stringify(result), err);
//   }
// });

// proto.screenPause = cort(function*(areaId, pauseDelta, areaServerId) {
//   let self = this;
//
//   return self.app.memdb.goose.transactionAsync(cort(function*() {
//     let modelArea = self.app.models.FishHunterArea;
//     let area = yield modelArea.findByIdAsync(areaId, 'pauseTime');
//
//     if (!!area) {
//       let now = Date.now();
//       area.pauseTime = now;
//       yield area.saveAsync();
//     }
//   }), areaServerId)
//   .catch((err) => {
//     logger.error('[collider][screenPause] areaId: %s, err: ', areaId, err);
//   });
// });

// proto._onColliderAsync = cort(function*(player, bullet, result) {
//   try {
//     if (!!result.error) return result;
//     let self = this;
//     let playerId = player._id;
//     let tableId = player.tableId;
//     let gameId = player.gameId;
//
//     let rsp = [];          // 回傳給子單處理的資料
//     let colliderData = []; // push給前端的碰撞資料
//     let highOddsData = []; // 高賠率廣播用的資料
//
//     for (let idx in result.data) {
//       let res = result.data[idx].res;   // 碰撞結果
//       let gain = result.data[idx].gain; // 玩家該次碰撞獲得的總彩金
//       let haveTreasure = false;
//       if (Object.keys(res.treasure).length > 0) haveTreasure = true;
//
//       // 單錢包
//       // switch (player.isSingleWallet) {
//       //   case consts.walletType.singleWallet:
//       //     // 鑽頭炮 & 雷射炮 & 機關炮 先 call bet 0
//       //     if (bullet.shootType == consts.FishType.DRILL || bullet.shootType == consts.FishType.LASER || bullet.shootType == consts.FishType.BAZOOKA) {
//       //       let betRes = yield self.app.controllers.fishHunterPlayer.callBet(player, 0, bullet);
//       //       if (betRes.code !== C.OK) return { error: betRes.code };
//       //     }
//       //     let isBonusGame = haveTreasure ? 1 : 0;
//       //     let winRes = yield self.app.controllers.fishHunterPlayer.callWin(player, res, bullet, gain, bullet.cost, isBonusGame);
//       //     if (winRes.code !== C.OK) return { error: winRes.code };
//       //     break;
//       //   case consts.walletType.singleBetAndWin:
//       //     let cost = bullet.cost;
//       //     // 鑽頭炮 & 雷射炮 & 機關炮 bet = 0;
//       //     if (bullet.shootType == consts.FishType.DRILL || bullet.shootType == consts.FishType.LASER || bullet.shootType == consts.FishType.BAZOOKA) cost = 0;
//       //     let betAndWinRes = yield self.app.controllers.fishHunterPlayer.callBetAndWin(player, res, bullet, gain, cost, false, []);
//       //     if (betAndWinRes.code !== C.OK) return { error: betAndWinRes.code };
//       //     break;
//       // }
//
//       let data = { // to子單用
//         areaId: player.areaId,
//         playerId: playerId,
//         gain: gain,
//         die: res.die,
//         fishTypes: res.ftypes.join(''),
//         gameId: gameId,
//         tableId: tableId,
//         gameServerId: player.gameServerId,
//         bullet: bullet,
//         treasure: res.treasure,
//         typeBombs: res.typeBombs,
//         bombTypeList: res.bombTypeList,
//         extraChainOdds: res.extraChainOdds,
//         state: res.state,
//         currency: player.currency,
//       };
//
//       // 有獲得 bazooka 免費子彈時 才有原始免費子彈數
//       if (typeof res['originalAlive'] != 'undefined') { data['originalAlive'] = res.originalAlive; }
//
//       if (res.ftypes.join('') == "")
//         this.app.controllers.debug.info('error','_onColliderAsync',{
//           player:     player,
//           res:        res
//         });
//
//       rsp.push(data);
//
//       highOddsData.push(_.cloneDeep(res));
//
//       // 刪除前端用不到的data
//       delete res.totalBonus;
//       delete res.hitresult;
//       delete res.odds;
//       delete res.success;
//       delete res.ftypes;
//       delete res.bombTypeList;
//       delete res.avgOdds;
//       delete res.randomConfig;
//       delete res.fishTemp;
//       delete res.extraBonusOdds;
//       delete res.rcCheck;
//       delete res.chairId;
//       delete res.originalAlive;
//       if (!haveTreasure) { delete res.treasure; } // 沒有寶藏刪除treasure key
//
//       colliderData.push(res); // to碰撞結果用
//     }
//
//     let data = { player: { id: playerId }, result: colliderData };
//     // let data = { player: { id: playerId, gold: 0, delta: gain }, result: colliderData };
//     self.app.controllers.table.pushAsync(tableId, null, consts.route.client.game.COLLIDER_RESULT, data, false);
//
//     self.app.controllers.broadcast.checkBroadcast(consts.BroadcastType.HIGH_ODDS, player, highOddsData); // 廣播高賠率訊息
//
//     return {error: null, data: rsp};
//   } catch (err) {
//     logger.error('[collider][_onColliderAsync] result: %s, err: ', JSON.stringify(result), err);
//   }
// });

// 一般子彈碰撞結算(寫入子彈歷史子注單)
proto._onColliderSettlement = cort(function* (result, tableLevel, player, killFirst, betSetting, extraBetTime) {
    try {
        let self = this;
        let cache = self.app.controllers.fishHunterCache;

        /* ============ 初始宣告 ============ */
        let playerId = '';
        let areaId = '';
        let gameId = '';
        let bulletData = {};
        let bulletId = 0;
        let isBonusGame = 0;
        let memWallet;
        // extraBet 用
        let extraBetGain = 0;
        let extraBetList = [];
        let extraBetKillFishes = false;

        for (let data of result) {
            playerId = data.playerId;
            areaId = data.areaId;
            gameId = data.gameId;
            let gain = data.gain;
            bulletId = data.bullet.bulletId;

            let betCash = data.bullet.cash;
            // 當 Bazooka 被視為一般子彈時
            if (data.bullet.shootType == consts.FishType.BAZOOKA) {
                betCash = data.bullet.cost;
            }

            memWallet = yield self.app.controllers.walletMgr.getWalletAsync(playerId, gameId);
            if (!memWallet) { // 玩家已經離開, 取不到 wallet (不應該再 createWallet)
                logger.warn('_onColliderSettlement memWallet is null ', util.inspect(result, false, 10));
                return;
            }

            let bulletCache = cache.getOneBulletHistoryByBulletId(playerId, bulletId);
            let subId = '';
            if (!!bulletCache) {
                subId = bulletCache._id;
            }
            let bulletIdcb = bulletId;
            let getInfocb = null;
            let getInfo = {};

            // 得到的treasure
            if (Object.keys(data.treasure).length > 0) {
                // 特殊武器
                if (typeof data.treasure.alive != 'undefined') {
                    getInfo['weapon'] = data.treasure;
                }
                // 其他bonus
                else {
                    getInfo['treasure'] = {};
                    getInfo['treasure']['odds'] = data.treasure.resultList;
                    getInfo['treasure']['bonus'] = data.treasure.amount;
                    getInfo['treasure']['type'] = data.treasure.type;
                    isBonusGame = 1; // Bonus Game 成立
                }
            }

            if (gain > 0) {
                // 試玩帳號 派彩 不進rc統計 // 先加 RC 再派彩
                if (!player.demo) {
                    if (!killFirst)
                        self.app.controllers.fishHunterRC.addRecord(data.currency, gameId, tableLevel, gain, self.app.controllers.fishHunterRC.RC_EVENT.GAIN, player.dc, betSetting.exchangeRate);
                    else
                        // 必死: 把cost的錢加回，因為已扣掉所以用GAIN補回
                        self.app.controllers.fishHunterRC.addRecord(data.currency, gameId, tableLevel, data.bullet.cost, self.app.controllers.fishHunterRC.RC_EVENT.GAIN, player.dc, betSetting.exchangeRate);
                }
            }

            let otherData = {isBonusGame, shootType: data.bullet.shootType, getWeapon: !!getInfo.weapon};
            let ret = memWallet.betResult(gain, data.bullet.denom, betCash, otherData, (err, data) => {
                const {wagerId, idx, betSucc, winSucc, code} = data;
                logger.debug('_onColliderSettlement betResult ', util.inspect({
                    wagerId,
                    code,
                    idx,
                    betSucc,
                    winSucc,
                    bulletIdcb,
                    getInfocb
                }, false, 10));

                if (!err && betSucc) {
                    //正常
                    self.app.controllers.bullet.normalBulletBetSucc(playerId, gameId, subId, wagerId, player.gameServerId, bulletIdcb, getInfocb);

                    return true;
                } else {
                    logger.info(`[collider][_onColliderSettlement][betResult] playerId: ${playerId}`, util.inspect({
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
                        if (code !== C.API_AUTH_TIME_OUT) {
                            // API回傳失敗，並且不是API超時或retry，處理失敗程序
                            let failRet = self.app.controllers.bullet.normalBulletBetFail(playerId, gameId, subId, wagerId, player.gameServerId, bulletIdcb, getInfocb);
                            // 有東西在印
                            if (failRet.bills && _.isArray(failRet.bills) && failRet.bills.length > 0)
                                logger.info(`[collider][_onColliderSettlement][RES] playerId: ${playerId}, failRet.bills:`, failRet.bills);

                            if (failRet.bills.length == 0) {
                                // if (failRet.freeGain == 0 && failRet.bills.length == 0) {
                                return true;
                            }

                            P.resolve()
                                .then(() => {
                                    return self.app.controllers.walletMgr.getWalletAsync(playerId, gameId);
                                })
                                .then((data) => {
                                    if (!!data) {
                                        let memWalletTemp = data;
                                        let tableIdTemp = player.tableId;

                                        // failRet.freeGain = utils.number.oneThousand(gain,consts.Math.DIVIDE);
                                        memWalletTemp.cancelFreeGain(failRet.freeGain, false, 1, failRet.bills, '_onColliderSettlement', (err, data) => {
                                            self.app.controllers.table.pushAsync(tableIdTemp, null, consts.route.client.game.UPDATE_BALANCE, {
                                                pid: playerId,
                                                balance: memWalletTemp.getRealTokens()
                                            }, false);

                                            memWalletTemp.waitClear(wagerId, idx);

                                            if (!!err) {
                                                logger.error('_onColliderSettlement memWallet.cancelFreeGain error ', util.inspect({
                                                    playerId,
                                                    gameId,
                                                    subId,
                                                    bulletIdcb,
                                                    getInfocb,
                                                    freeGain
                                                }, false, 10));
                                            }

                                        })
                                    } else {
                                        logger.error('_onColliderSettlement cancelFreeGain memWallet is null ', util.inspect({
                                            playerId,
                                            gameId,
                                            subId,
                                            bulletIdcb,
                                            getInfocb,
                                            freeGain
                                        }, false, 10));
                                    }
                                })

                            return false;
                        } else {
                            if (player.isSingleWallet == consts.walletType.singleBetAndWinDelay && code == C.API_AUTH_TIME_OUT) {
                                // 後扣型錢包 // api 回傳 timeout 或 retry // redis 存入一般子彈可能扣款成功的 subId
                                self.app.controllers.redisCache.addSubIdFromAPIfail(player.gameServerId, subId, wagerId, wagerId);
                            }
                            return true;
                        }
                    } else {
                        return true;
                    }
                }
            });

            if (!ret) {
                if (data.bullet.shootType == consts.FishType.BAZOOKA) {
                    logger.warn('[collider][_onColliderSettlement] playerId: %s, bazooka be changed normal, memWallet.betResult bet fail. ', player._id);
                } else {
                    logger.error('[collider][_onColliderSettlement] playerId: %s, memWallet is disable ', player._id,);
                }
                return;
            }

            if (Object.keys(data.treasure).length > 0) {
                memWallet.debugGetWeaponBetFail(ret.wagerId, ret.lastIndex);
            }

            getInfocb = getInfo;

            // bomb & chain 連鎖打到的魚
            if (data.typeBombs.length > 0) {
                getInfo[data.state] = {};
                getInfo[data.state]['fishes'] = data.bombTypeList;
                getInfo[data.state]['extraOdds'] = data.extraChainOdds;
            }

            bulletData = {
                gain: gain,
                bulletId: bulletId,
                killFishes: data.die,
                hitFishes: data.fishTypes,
                createTime: utils.timeConvert(Date.now()),
                getInfo: getInfo,
                wId: ret.wagerId,
                idx: ret.lastIndex,
                // 用於當 cache 被刪除時，需補單時的資料
                sbuRepair: {
                    cost: betCash,
                    _id: subId,
                    denom: data.bullet.denom
                }
            };

            if (!extraBetTime) {
                // 當 Bazooka 被視為一般子彈時
                if (data.bullet.shootType == consts.FishType.BAZOOKA) {
                    let normalShootType = 'normal';
                    bulletData.shootType = normalShootType;
                    bulletData.cost = betCash;
                    bulletData.alive = -2; // 作為子單查詢依據
                    if (bulletData.hasOwnProperty('getInfo') && bulletData.getInfo.hasOwnProperty('originalCost')) {
                        delete bulletData.getInfo.originalCost;
                    }
                    logger.info(`[collider] bazooka be changed normal. playerId: ${playerId}, bulletData: ${JSON.stringify(bulletData)}, bullet: ${JSON.stringify(data.bullet)}`);
                }
                yield self.app.controllers.bullet.handleBulletCollider(player, bulletData, false);
            } else {
                bulletData.bet = data.bullet.cost; // 更新 cost 用
                extraBetGain = utils.number.add(extraBetGain, gain); // 加總extraBet總贏分
                extraBetKillFishes = extraBetKillFishes || data.die;
                // 黃金炸彈有獲得 bonus weapon typeBombs
                if (Object.keys(getInfo).length > 0) {
                    let getKeys = Object.keys(getInfo);
                    // 本身打中的魚與bonus type不相同時，視為額外獲得，並且存入: 本身的賠率(odds)&魚種(type)以及額外獲得的bonus(extraBonus)
                    if (getKeys.indexOf('treasure') > -1 && typeof getInfo.treasure.odds !== 'undefined' && getInfo.treasure.type !== data.fishRealType) {
                        // 額外觸發的獎勵
                        getInfo['fishTriggerExtra'] = {};
                        // 有打死才放本身賠率
                        if (data.die) getInfo['fishTriggerExtra']['odds'] = data.odds;
                        getInfo['fishTriggerExtra']['type'] = data.fishRealType;
                        getInfo['fishTriggerExtra']['extraBonus'] = getInfo.treasure;
                        // 刪除原本儲存格式
                        delete getInfo.treasure;
                    }
                    extraBetList.push(getInfo);
                }
                // 其他魚
                else {
                    // 有打死才放
                    if (data.die) extraBetList.push({odds: data.odds, type: data.fishRealType});
                }
            }

            cache.bulletBomb(playerId, bulletId); // 已經碰撞的就刪除子彈的cache

            this.app.controllers.debug.info('info', '_onColliderSettlement', {
                playerId: playerId,
                areaId: areaId,
                bulletId: bulletId,
                bulletData: bulletData,
            });
        }/*forEnd*/

        // 更新餘額
        self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_BALANCE, {
            pid: playerId,
            balance: memWallet.getRealTokens()
        }, false);

        if (extraBetTime) {
            bulletData.hitFishes = consts.FishState.EXTRA_BET;
            bulletData.killFishes = extraBetKillFishes;
            // 更新真實花費
            bulletData.cost = utils.number.multiply(bulletData.bet, extraBetTime);
            // 更新總獲得贏分
            bulletData.gain = extraBetGain;
            // 有獲得 bonus weapon typeBombs
            if (extraBetList.length > 0) {
                bulletData.getInfo = {};
                bulletData.getInfo[consts.FishState.EXTRA_BET] = extraBetList;
                bulletData.getInfo['originalCost'] = bulletData.bet;
            }
            yield self.app.controllers.bullet.handleBulletCollider(player, bulletData, false);
        }

        return;
    } catch (err) {
        logger.error('[collider][_onColliderSettlement] result: %s, err: ', JSON.stringify(result), err);
    }
});

// 特殊武器碰撞結算(寫入子彈歷史子注單)
proto._onExWeaponColliderSettlement = cort(function* (result, bomb, tableLevel, player, killFirst, betSetting) {
    try {
        let self = this;
        let cache = self.app.controllers.fishHunterCache;
        /* ============ 初始宣告 ============ */
        let playerId = player._id;
        let areaId = '';
        let gameId = '';
        let gain = 0;
        let isBonusGame = 0;
        let bulletId = 0;
        let alive = result[0]['bullet']['alive']; // 取第一筆武器資訊的alive
        let cost = null;
        let weaponTypeObj = {};
        let memWallet = null;

        for (let data of result) {
            areaId = data.areaId;
            gameId = data.gameId;
            gain = data.gain;
            bulletId = data.bullet.bulletId;
            weaponTypeObj = data.bullet;
            let getBazooka = false;
            let getInfo = {};
            let subId = '';
            if (data.bullet.level === consts.FishType.BAZOOKA) {
                // 機關炮
                let bulletCache = cache.getOneBulletHistoryByBulletId(playerId, bulletId);
                if (!!bulletCache) {
                    subId = bulletCache._id;
                }
            } else {
                // 鑽頭炮 & 雷射炮 & 炸彈蟹 & 連環炸彈蟹
                subId = utils.shortid(); // 生子單id
            }
            // 得到的treasure
            if (Object.keys(data.treasure).length > 0) {
                // 特殊武器
                if (typeof data.treasure.alive != 'undefined') {
                    getInfo['weapon'] = data.treasure;
                    // 武器是機關炮 且又獲得免費子彈時
                    if (data.bullet.level === consts.FishType.BAZOOKA) getBazooka = true;
                }
                // 其他bonus
                else {
                    getInfo['treasure'] = {};
                    getInfo['treasure']['odds'] = data.treasure.resultList;
                    getInfo['treasure']['bonus'] = data.treasure.amount;
                    getInfo['treasure']['type'] = data.treasure.type;
                    isBonusGame = 1; // Bonus Game 成立
                }
            }

            memWallet = yield self.app.controllers.walletMgr.getWalletAsync(playerId, gameId);
            if (!memWallet) { // 玩家已經離開, 取不到 wallet (不應該再 createWallet), 此時把 alive 加回
                if (weaponTypeObj.level === consts.FishType.BAZOOKA) {
                    let bazooka = cache.getBazookaAlive(playerId, weaponTypeObj.cost);
                    if (!!bazooka) {
                        bazooka.alive += 1;
                        return;
                    } // 有找到 bazooka cache 就加回 alive
                } else {
                    let _wp = cache.getTreasure(playerId, bulletId);
                    if (!!_wp) {
                        _wp.alive += 1;
                        return;
                    } // 有找到 treasure cache 就加回 alive
                }
                return;
            }

            if (gain > 0) {
                // 試玩帳號 派彩 不進rc統計 // 先加 RC 再派彩
                if (!player.demo)
                    if (!killFirst)
                        self.app.controllers.fishHunterRC.addRecord(data.currency, gameId, tableLevel, gain, self.app.controllers.fishHunterRC.RC_EVENT.GAIN, player.dc, betSetting.exchangeRate);
            }

            let otherData = {isBonusGame, shootType: data.bullet.shootType};
            let ret = memWallet.betResult(gain, data.bullet.denom, 0, otherData, async (err, data) => {
                const {wagerId, idx, betSucc, winSucc, code} = data;
                logger.debug('_onExWeaponColliderSettlement betResult ', util.inspect({
                    wagerId,
                    code,
                    idx,
                    betSucc,
                    winSucc
                }, false, 10));

                if (!err && betSucc && winSucc) {
                    //正常
                    return true;
                } else {
                    logger.info(`[collider][_onExWeaponColliderSettlement][betResult] playerId: ${playerId}`, util.inspect({
                        wagerId,
                        code,
                        subId,
                        idx,
                        betSucc,
                        winSucc
                    }, false, 10));

                    //错误处理
                    if (!betSucc) {
                        if (player.isSingleWallet == consts.walletType.singleBetAndWinDelay && code !== C.API_AUTH_TIME_OUT) {
                            // 刪除 memdb 已存入的子單
                            self.app.controllers.daoMgr.getBulletHistoryDao().removeByIdAsync(subId);
                        }

                        let sessionId = await self.app.controllers.fishHunterPlayer.getPlayerSessionId(player, '_onExWeaponColliderSettlement');
                        if (sessionId == null) return true;

                        P.resolve()
                            .then(() => {
                                return self.app.controllers.walletMgr.getWalletAsync(playerId, gameId);
                            })
                            .then((data) => {
                                if (!!data) {
                                    let memWalletTemp = data;
                                    let tableIdTemp = player.tableId;

                                    self.app.controllers.table.pushAsync(tableIdTemp, null, consts.route.client.game.UPDATE_BALANCE, {
                                        pid: playerId,
                                        balance: memWalletTemp.getRealTokens()
                                    }, false);

                                } else {
                                    logger.warn('_onExWeaponColliderSettlement cancelFreeGain memWallet is null ', util.inspect({
                                        playerId,
                                        gameId
                                    }, false, 10));
                                }
                            });

                        return true;
                    } else {
                        return true;
                    }
                }
            });

            if (!ret) {
                logger.error('[collider][_onExWeaponColliderSettlement] playerId: %s, memWallet is disable ', player._id,);
                return;
            }

            // bomb & chain 連鎖打到的魚
            if (data.typeBombs.length > 0) {
                getInfo[data.state] = {};
                getInfo[data.state]['fishes'] = data.bombTypeList;
                getInfo[data.state]['extraOdds'] = data.extraChainOdds;
            }

            getInfo['originalCost'] = data.bullet.cost; // 原始押注分數

            let bulletData = { // bulletHistory: 存子單的資料
                _id: subId,
                gain: gain || 0,
                killFishes: data.die,
                hitFishes: data.fishTypes,
                alive: --alive,
                denom: data.bullet.denom,
                shootType: data.bullet.shootType,
                cost: 0,
                bulletId: bulletId,
                playerId: playerId,
                areaId: areaId,
                gameId: gameId,
                createTime: utils.timeConvert(Date.now()),
                getInfo: getInfo,
                getBulletId: data.bullet.getBulletId,
                wId: ret.wagerId,
                idx: ret.lastIndex
            };

            if (data.bullet.level === consts.FishType.BAZOOKA) {
                // 機關炮
                cost = data.bullet.cost;
                if (!!getBazooka) {
                    bulletData['alive'] = data.originalAlive; // 原始剩餘子彈數
                } else {
                    bulletData['alive'] = data.bullet.alive;
                }

                let bazooka = cache.getBazookaAlive(playerId, cost);
                if (!!bazooka) bazooka.actualAlive -= 1;
            } else {
                // 鑽頭炮 & 雷射炮 & 炸彈蟹 & 連環炸彈蟹
                let wp = cache.getTreasure(playerId, bulletId);
                if (!!wp) wp.actualAlive -= 1;
                // 塞入來源 wid
                bulletData.sourceWid = weaponTypeObj.sourceWid;
            }
            yield self.app.controllers.bullet.handleBulletCollider(player, bulletData, true);

            this.app.controllers.debug.info('info', '_onExWeaponColliderSettlement', {
                playerId: playerId,
                areaId: areaId,
                bulletData: bulletData,
                getBazooka: getBazooka,
            });
        }/*forEnd*/

        self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_BALANCE, {
            pid: playerId,
            balance: memWallet.getRealBalance()
        }, false);

        // 當alive=0
        if (bomb) self.handleWeaponBomb(player, weaponTypeObj, cost);

    } catch (err) {
        logger.error('[collider][_onExWeaponColliderSettlement] playerId: %s, result: %s, err: ', player._id, JSON.stringify(result), err);
    }
});

proto.handleWeaponBomb = async function (player, weapon, isBazooka) {
    try {
        let self = this;
        let areaPlayerDao = self.app.controllers.daoMgr.getAreaPlayerDao();
        let cache = self.app.controllers.fishHunterCache;
        let playerId = player._id;
        let bulletId = weapon.bulletId;
        let serverId = player.gameServerId;
        if (!isBazooka) {
            // drill laser
            // === 清除areaPlayer.gunInfo裡 已結束(alive=0)的特殊武器 ============
            await areaPlayerDao.clearGunInfoAsync(weapon.areaId, playerId, false, bulletId, weapon.cost, serverId);
            if (!cache.delTreasure(playerId, bulletId)) {
                logger.warn('[collider][handleWeaponBomb] cache.delTreasure fail, playerId: ', playerId, ' bulletId: ', bulletId);
            }
        } else {
            // bazooka
            let bazookaAlive = _.cloneDeep(cache.getBazookaAlive(playerId, weapon.cost));
            logger.warn('[collider][handleWeaponBomb] playerId: %s, getBazookaAlive bazookaAlive: ', playerId, bazookaAlive);
            if (!!bazookaAlive && bazookaAlive.alive == 0) {
                logger.warn('[collider][handleWeaponBomb][bazooka alive 刪除] playerId: %s, bazookaAlive: ', playerId, bazookaAlive);
                // === 清除areaPlayer.gunInfo裡 已結束(alive=0)的特殊武器 ============
                await areaPlayerDao.clearGunInfoAsync(weapon.areaId, playerId, true, bulletId, weapon.cost, serverId);
                cache.delBazookaAlive(playerId, weapon.cost); // 刪除: 機關炮碰撞剩餘子彈數
                // cache.delBazookaTreasure(playerId); // 刪除: 機關炮存在 Treasure cache 的資料

                self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.BULLET_BOMB, {
                    alive: bazookaAlive.alive,
                    bulletId: bulletId,
                    chairId: weapon.chairId,
                    cost: weapon.cost,
                    level: weapon.level,
                    lockTargetId: weapon.lockTargetId,
                    playerId: weapon.playerId,
                }, false);
            } else {
                logger.warn(`[collider][handleWeaponBomb][bazooka alive 刪除] alive !== 0 想刪我？不給刪！ playerId: ${playerId} [bazookaAlive]`, bazookaAlive);
            }
        }
    } catch (err) {
        logger.error(`[collider][handleWeaponBomb] playerId: ${player._id}, weapon: ${JSON.stringify(weapon)} bazooka: ${JSON.stringify(bazooka)}, err: `, err);
    }
};
