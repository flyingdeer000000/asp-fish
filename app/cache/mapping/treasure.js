let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../../share/constant');
let utils = require('../../utils/utils');
let consts = require('../../../share/consts');
let logger = quick.logger.getLogger('fire', __filename);

module.exports = treasure = {};

treasure.collect = function (client, val, cb) {
    let app = client;
    let perfTimer = client.perfTimer;
    let hrTimer = null;
    const paramDefinConf = app.controllers.fishHunterConfig.getParamDefinConfig();
    const weaponContrast = paramDefinConf.weaponContrast;
    const weaponList = paramDefinConf.weapon;
    P.resolve(val)
        .then((data) => {
            if (!!perfTimer) {
                hrTimer = utils.hrtimer(true);
            }

            let playerId = '';
            let gameId = '';
            let sharId = '';
            let areaId = '';
            let sourceWid = '';
            let betSetting = null;

            if (data.length > 0) {
                playerId = data[0].playerId;
                gameId = data[0].gameId;
                sharId = data[0].gameServerId;
                areaId = data[0].areaId;
                betSetting = data[0].betSetting;
                sourceWid = data[0].sourceWid;
            } else {
                return P.resolve({});
            }

            let amount = 0;
            for (let i in data) {
                if (weaponList.indexOf(data[i].type) > -1) amount += 1;
            }

            return app.memdb.goose.transactionAsync(P.coroutine(function* () {
                let result = {};

                if (amount > 0) {
                    let modelAreaPlayers = app.models.FishHunterAreaPlayers;
                    let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: areaId, playerId: playerId});

                    if (!!areaPlayer) {

                        if (!areaPlayer.gunEx) areaPlayer.gunEx = {}

                        if (!areaPlayer.gunInfo) areaPlayer.gunInfo = [];

                        for (let i in data) {

                            if (!areaPlayer.gunEx[weaponContrast[data[i].type]]) {
                                areaPlayer.gunEx[weaponContrast[data[i].type]] = 0; // 初始化
                            }

                            if (data[i].type == consts.FishType.DRILL || data[i].type == consts.FishType.LASER ||
                                data[i].type == consts.FishType.BOMB_CRAB || data[i].type == consts.FishType.SERIAL_BOMB_CRAB) {
                                areaPlayer.gunEx[weaponContrast[data[i].type]] += 1; // onFire 一次
                            } else if (data[i].type == consts.FishType.BAZOOKA) {
                                // bazooka
                                areaPlayer.gunEx[weaponContrast[data[i].type]] += data[i].weaponsInfo.alive; // onFire 多次
                            }
                        }

                        // ===== 取得到的特殊武器才將資訊存到玩家的gunInfo ======
                        for (let i in data) {
                            if (!data[i].weaponsInfo) continue;
                            let weaponsInfo = data[i].weaponsInfo;
                            let shootType = data[i].shootType;
                            let bulletId = data[i].bulletId;
                            let pushData = {
                                bid: bulletId,
                                alive: weaponsInfo.alive,
                                sourceWid: sourceWid
                            };

                            if (weaponsInfo.type == consts.FishType.BAZOOKA && areaPlayer.gunInfo.length > 0) {
                                // 獲得 bazooka ，且 player 身上有剩餘特殊武器
                                for (let j = 0; j < areaPlayer.gunInfo.length; j++) {
                                    if (areaPlayer.gunInfo[j].type == weaponsInfo.type && areaPlayer.gunInfo[j].cost === weaponsInfo.cost) {
                                        // 找 player 身上的 bazooka && 同 cost 的
                                        if (shootType == consts.FishType.BAZOOKA) {
                                            // 使用 bazooka 再次獲得免費子彈 // 保留原本獲得免費武器的一般子彈ID // 加上免費子彈數量
                                            if (!areaPlayer.gunInfo[j].getBullet[0]) {
                                                // 最後一發獲得免費子彈，getBullet已被 onFire 拔除，所以須重新寫入。
                                                pushData.bid = data[i].getBulletId;
                                                areaPlayer.gunInfo[j].getBullet[0] = pushData;
                                            } else {
                                                areaPlayer.gunInfo[j].getBullet[0].alive += weaponsInfo.alive; // 獲得免費武器的子彈ID
                                            }
                                        } else {
                                            areaPlayer.gunInfo[j].getBullet.push(pushData); // 獲得免費武器的子彈ID
                                        }
                                        areaPlayer.gunInfo[j].alive += weaponsInfo.alive; // 相同 cost 累加子彈數
                                        break;
                                    } else if (j === areaPlayer.gunInfo.length - 1) {
                                        weaponsInfo.getBullet.push(pushData); // 獲得免費武器的子彈ID
                                        areaPlayer.gunInfo.push(weaponsInfo); // 找不到符合的就 push
                                        break;
                                    }
                                }
                            } else {
                                weaponsInfo.getBullet.push({bid: bulletId, alive: weaponsInfo.alive}); // 獲得免費武器的子彈ID
                                areaPlayer.gunInfo.push(weaponsInfo);
                            }

                        }
                        // ===================================================
                        areaPlayer.markModified('gunEx');
                        areaPlayer.markModified('gunInfo');

                        logger.info(`[treasure.collect] playerId: ${playerId}, gunEx: ${JSON.stringify(areaPlayer.gunEx)}, gunInfo: ${JSON.stringify(areaPlayer.gunInfo)}`);

                        yield areaPlayer.saveAsync();

                        if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
                            logger.error(`[treasure][collect] no betSetting! playerId: ${areaPlayer.playerId}`);
                            return P.reject(C.ERROR);
                        }
                        result.areaPlayer = areaPlayer.toClientData(betSetting);
                    } else {
                        return P.reject(C.ERROR);
                    }
                }

                if (!!hrTimer) {
                    perfTimer.add('voucher.reward s2', hrTimer.stop());
                }

                return result;

            }), sharId);
        })
        .catch((err) => {
            logger.error('[treasure][treasure.collect] playerId: %s, err: ', val[0].playerId, err);
        })
        .nodeify(cb);
}
