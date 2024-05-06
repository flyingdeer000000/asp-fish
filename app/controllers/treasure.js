'use strict';
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../share/constant');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('fire', __filename);
let utils = require('../utils/utils');
const uuid = require('uuid/v1');
let m_objRNGMethod;

let Controller = function (app) {
    this.app = app;

    let strRNGPath = './lib/RNG/GameLogicInterface';
    // let strRNGPath = app.getBase() + '/lib/RNG/GameLogicInterface';
    m_objRNGMethod = utils.randProbability.loadRNGDll(strRNGPath);
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

proto._checkTreasureAsync = cort(function* (result, player, bullet, betSetting) {
    try {
        if (result.error) return result;//{ error: null, data: result };

        const self = this;
        let sync = self.app.get('sync');
        let treasureArr = [];
        let treasureObj = {}; // 儲存寶藏基本資訊

        const playerId = player._id;
        const areaId = player.areaId;
        const gameId = player.gameId;
        const gameServerId = player.gameServerId;
        const tableLevel = player.tableLevel;

        // fishHunter_{table}.json
        const fishHunterConfig = self.app.controllers.fishHunterConfig.getGameConfig(gameId, tableLevel);
        const treasureList = fishHunterConfig.treasureList;
        const bonusConfig = self.app.controllers.fishHunterConfig.getBonusConfig(gameId);
        const weaponAliveAlgConfig = self.app.controllers.fishHunterConfig.getWeaponAliveAlgConfig(gameId);

        //levels
        let cache = this.app.controllers.fishHunterCache;
        let levels = _.cloneDeep(cache.getFishAlgArgs(player, tableLevel));
        // if (!levels) levels = cache.getFishAlgArgs(gameId);
        if (!levels) levels = 'normal';

        result = result.data;
        let scene = -1;
        for (let i in result) {
            scene = result[i].scene;
            let data = result[i].res;
            let treasure = data.treasure;

            // if (data.die && !!treasure && treasure.length > 0) {
            if (!!treasure && treasure.length > 0) {
                logger.info(`[treasure][_checkTreasureAsync] playerId: ${playerId}, bulletId: ${data.bid}, treasure: `, treasure);

                for (let t in treasure) {
                    // 取得各 treasure 的資料
                    let treasureInfo = yield self.getTreasureByType(
                        data,
                        bonusConfig, weaponAliveAlgConfig,
                        treasure[t],
                        levels,
                        player,
                    );
                    logger.info(`[treasure][_checkTreasureAsync] playerId: ${playerId}, bulletId: ${data.bid}, treasureInfo: `, treasureInfo);
                    if (treasureList.indexOf(treasure[t]) !== -1) {
                        let amount = treasureInfo.amount;
                        // amount=undefined 或 (被打中的魚種類是treasure類 && 有打死), 子單結算會派彩 treasure.collect就不派彩
                        if (!amount || (treasureList.indexOf(data.fishRealType) !== -1 && data.die)) {
                            amount = 0;
                        }
                        treasureObj = {
                            id: uuid(),
                            type: treasureInfo.type,
                            amount: amount,
                            playerId: playerId,
                            areaId: areaId,
                            gameServerId: gameServerId,
                            gameId: gameId,
                            bulletId: data.bid,
                            getBulletId: bullet.getBulletId,
                            shootType: bullet.shootType,
                        };
                        result[i].gain = utils.number.add(result[i].gain, amount); // 子單結算要寫入這次碰撞總獲得的紀錄
                    } else {
                        logger.error('unknown treasure ', treasure[t]);
                    }

                    if (treasureInfo.jps !== undefined) { // 轉盤、紅包、五彩秘寶、巨蚌秘寶2
                        data.treasure = treasureInfo.jps; // treasure資料存入
                    } else { // Fish_300(機關炮)、Fish_301(鑽頭炮)、Fish_302(雷射炮)
                        data.treasure = treasureInfo; // treasure資料存入
                        // 特殊武器詳細資訊存到memdb
                        treasureObj['weaponsInfo'] = {
                            cost: data.cost,                  // 取得這項武器的 子彈成本
                            type: treasureInfo.type,          // 武器種類
                            bulletId: 0,                      // 武器發射後的子彈ID 這裡先設初始
                            alive: treasureInfo.alive,        // 武器取得的alive
                            getBullet: [],                    // 獲得免費武器的子彈ID
                            sourceWid: player.wId             // 當下獲得特殊武器時的wId
                        };
                    }
                    logger.info(`[treasure][_checkTreasureAsync] playerId: ${playerId}, bulletId: ${data.bid}, treasureObj: ${JSON.stringify(treasureObj)}, weaponsInfo: `, treasureObj['weaponsInfo']);

                    treasureObj['betSetting'] = betSetting;
                    treasureArr.push(treasureObj);

                    // // 風控
                    // logger.error('3');
                    // self.app.controllers.fishHunterRC.addRecord(player.currency, gameId, tableLevel, amount, self.app.controllers.fishHunterRC.RC_EVENT.GAIN);
                }
            } else {
                data.treasure = {};
            }
        }
        if (treasureArr.length === 0) return {error: null, data: result};

        sync.execSync('treasure.collect', treasureArr, function (err, res) {
            // logger.info('treasure.collect ', res);

            if (err) {
                logger.error('[treasure][treasure.collect] err : ', err);
            }
        })

        // self.treasureCollect(treasureArr, function (err, res) {
        //         // logger.info('treasure.collect ', res);
        //
        //         if (err) { logger.error('[treasure][treasureCollect] err : ', err); }
        //     })
        return {error: null, data: result};
    } catch (err) {
        logger.error('[treasure][_checkTreasureAsync] player: %s, result: %s, err: ', JSON.stringify(player), JSON.stringify(result), err);
    }
});

// proto.treasureCollect = cort(function*(val, cb) {
//     let self = this;
//     P.resolve(val)
//         .then((data) => {
//             let playerId = '';
//             let gameId = '';
//             let sharId = '';
//             let areaId = '';
//
//             if(data.length > 0){
//                 playerId = data[0].playerId;
//                 gameId = data[0].gameId;
//                 sharId = data[0].gameServerId;
//                 areaId = data[0].areaId;
//             }
//             else{
//                 logger.error('[treasureCollect] return by data.length <= 0');
//                 return P.resolve({});
//             }
//
//             return self.app.memdb.goose.transactionAsync(P.coroutine(function* () {
//                 let drill = 0;
//                 let laser = 0;
//                 let bazooka = 0;
//                 let result = {};
//
//                 for (let i in data) {
//                     if (data[i].type == consts.FishType.DRILL) {
//                         drill += 1;
//                     }
//                     else if(data[i].type == consts.FishType.LASER) {
//                         laser += 1;
//                     }
//                     else if(data[i].type == consts.FishType.BAZOOKA) {
//                         bazooka += data[i].weaponsInfo.alive;
//                         logger.error('[treasureCollect] 獲得 %s 發', bazooka);
//                     }
//                 }
//
//                 if(drill > 0 || laser > 0 || bazooka > 0) {
//                     let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
//                     let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: areaId, playerId: playerId});
//
//                     if (!!areaPlayer) {
//
//                         if(!areaPlayer.gunEx) {
//                             areaPlayer.gunEx = {}
//                         }
//
//                         if(!areaPlayer.gunInfo) {
//                             areaPlayer.gunInfo = [];
//                         }
//
//                         if(!areaPlayer.gunEx.drill) {
//                             areaPlayer.gunEx.drill = 0;
//                         }
//
//                         if(!areaPlayer.gunEx.laser) {
//                             areaPlayer.gunEx.laser = 0;
//                         }
//
//                         if(!areaPlayer.gunEx.bazooka) {
//                             areaPlayer.gunEx.bazooka = 0;
//                         }
//
//                         areaPlayer.gunEx.drill += drill;
//                         areaPlayer.gunEx.laser += laser;
//                         areaPlayer.gunEx.bazooka += bazooka;
//                         logger.error('[treasureCollect] areaPlayer.gunEx.bazooka = ', areaPlayer.gunEx.bazooka)
//
//                         // ===== 取得到的特殊武器才將資訊存到玩家的gunInfo ======
//                         for (let i in data) {
//                             if (!data[i].weaponsInfo) continue;
//                             if (data[i].weaponsInfo.type == consts.FishType.BAZOOKA && areaPlayer.gunInfo.length > 0) {
//                                 for (let j = 0; j < areaPlayer.gunInfo.length; j++) {
//                                     if (areaPlayer.gunInfo[j].cost === data[i].weaponsInfo.cost) {
//                                         // 相同 cost 累加子彈數
//                                         areaPlayer.gunInfo[j].alive += data[i].weaponsInfo.alive;
//                                         break;
//                                     } else if (j === areaPlayer.gunInfo.length - 1) {
//                                         // 找不到符合的就 push
//                                         areaPlayer.gunInfo.push(data[i].weaponsInfo);
//                                         break;
//                                     }
//                                 }
//                             } else {
//                                 areaPlayer.gunInfo.push(data[i].weaponsInfo);
//                             }
//                         }
//                         // ===================================================
//                         areaPlayer.markModified('gunEx');
//                         areaPlayer.markModified('gunInfo');
//                         yield areaPlayer.saveAsync();
//
//                         result.areaPlayer = areaPlayer.toClientData();
//                     }
//                     else{
//                         return P.reject(C.ERROR);
//                     }
//                 }
//
//                 return result;
//
//             }),sharId);
//         })
//         .catch((err) => {
//             logger.error('[treasure][treasureCollect] playerId: %s, err: ', val[0].playerId, err);
//         })
//         .nodeify(cb);
// });

// 取得各個寶藏的資訊
proto.getTreasureByType = function (data, bonusConfig, weaponAliveAlgConfig, fishType, levels, player, getMinOdds, randomResult) {
    try {
        const self = this;
        let randomTable;
        let freeBulletAlive = 0;
        let odds = 0;

        if (getMinOdds) {
            /***************取最小賠率，需自帶機率*************
             1.一般擊中的 treasure:
             levels = null; // 必須帶 null
             randomResult = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod); //先抽TABLE
             2.額外觸發的 bonus (by Lucky Draw):
             randomResult = utils.randProbability.getRand(collectionDrawConfig.collectionDraw[1].tabvals,'triggerprob', m_objRNGMethod); // 取觸發的bonus
             3.額外觸發的 bonus (by Boss):
             randomResult = utils.randProbability.getRand(randomResult.tabvals,'triggerprob', m_objRNGMethod); // getExtraBonus //抽要觸發哪種bonus
             ***********************************************/
            if (!bonusConfig) {
                bonusConfig = this.app.controllers.fishHunterConfig.getBonusConfig(player.gameId);
            }
            // 額外觸發的 bonus，需先抽要哪個level的TABLE
            let randomTable = !!levels ? utils.randProbability.getRand(randomResult.val[levels], 'tabprob', m_objRNGMethod) : randomResult;
            // 額外觸發的 bonus，用 val, 一般擊中的 treasure 用 bonus
            let oddsKey = !!levels ? 'val' : 'bonus';

            randomTable = randomTable.tabvals.filter(item => item[oddsKey] !== 0); // 過濾 val 0 的
            let oddsList = randomTable.map((item) => {
                return item[oddsKey]
            });
            let minOdds = Math.min.apply(null, oddsList);
            odds = minOdds;
            logger.info(`[treasure][getTreasureByType] getMinOdds playerId: ${player._id}, gameId: ${player.gameId}, fishType: ${fishType}, minOdds: ${minOdds}, oddsList:`, oddsList);
        }

        const dataArr = {
            'Fish_300': async function () { // 機關炮
                try {
                    randomTable = weaponAliveAlgConfig.bazookaAlive[levels][data.randomConfig.RTP];       //先依levels RTP決定TABLE
                    freeBulletAlive = utils.randProbability.getRand(randomTable, 'prob', m_objRNGMethod).alive;   //依權重給免費子彈(alive)
                    logger.info(`[treasure][getTreasureByType] start add bazooka. playerId: ${player._id}, bulletId: ${data.bid}, cost: ${data.cost}, config freeBulletAlive: `, freeBulletAlive);
                    if (!freeBulletAlive) freeBulletAlive = 0; // 設定檔不存在alive給0

                    let backend = await self.app.controllers.fishHunterPlayer.getBackendSessions_rpc(player);
                    let handleBazooka = null;
                    if (!!backend && !!backend.sessions && backend.sessions.length > 0 && !!backend.sessions[0].get('fireServer')) {
                        // call rpc 處理增加子彈數到 cache 裡
                        handleBazooka = await P.promisify(backend.rpc.handleBazooka.toServer, backend.rpc.handleBazooka)(
                            backend.sessions[0].get('fireServer'), player._id, player.gameId, player.tableLevel, data.cost, freeBulletAlive
                        );

                        freeBulletAlive = handleBazooka.alive; // 實際獲得子彈數
                        data.originalAlive = handleBazooka.originalAlive; // 原始剩餘子彈數(寫子單更新alive用)
                    }
                    logger.info(`[treasure][getTreasureByType] end add bazooka. playerId: ${player._id}, bulletId: ${data.bid}, cost: ${data.cost}, handleBazooka: `, handleBazooka);
                    return {type: consts.FishType.BAZOOKA, alive: freeBulletAlive};
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_300 playerId: %s, err : ', player._id, err);
                }
            },
            'Fish_301': async function () { // 鑽頭炮
                try {
                    randomTable = weaponAliveAlgConfig.drillAlive[levels][data.randomConfig.RTP];       //先依levels RTP決定TABLE
                    freeBulletAlive = utils.randProbability.getRand(randomTable, 'prob', m_objRNGMethod).alive;   //依權重給免費子彈(alive)
                    logger.info(`[treasure][getTreasureByType] start add drill. playerId: ${player._id}, bulletId: ${data.bid}, cost: ${data.cost}, config freeBulletAlive: `, freeBulletAlive);
                    if (!freeBulletAlive) freeBulletAlive = 0; // 設定檔不存在alive給0
                    return {type: consts.FishType.DRILL, alive: freeBulletAlive};
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_301 playerId: %s, err : ', player._id, err);
                }
            },
            'Fish_302': async function () { // 電磁炮
                try {
                    randomTable = weaponAliveAlgConfig.laserAlive[levels][data.randomConfig.RTP];       //先依levels RTP決定TABLE
                    freeBulletAlive = utils.randProbability.getRand(randomTable, 'prob', m_objRNGMethod).alive;   //依權重給免費子彈(alive)
                    logger.info(`[treasure][getTreasureByType] start add laser. playerId: ${player._id}, bulletId: ${data.bid}, cost: ${data.cost}, config freeBulletAlive: `, freeBulletAlive);
                    if (!freeBulletAlive) freeBulletAlive = 0; // 設定檔不存在alive給0
                    return {type: consts.FishType.LASER, alive: freeBulletAlive};
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_302 playerId: %s, err : ', player._id, err);
                }
            },
            'Fish_308': async function () { // 炸彈蟹   範圍免費碰撞
                try {
                    randomTable = weaponAliveAlgConfig.bombCrabAlive[levels][data.randomConfig.RTP];       //先依levels RTP決定TABLE
                    freeBulletAlive = utils.randProbability.getRand(randomTable, 'prob', m_objRNGMethod).alive;   //依權重給免費子彈(alive)
                    logger.info(`[treasure][getTreasureByType] start add bombCrab. playerId: ${player._id}, bulletId: ${data.bid}, cost: ${data.cost}, config freeBulletAlive: `, freeBulletAlive);
                    if (!freeBulletAlive) freeBulletAlive = 0; // 設定檔不存在alive給0
                    return {type: consts.FishType.BOMB_CRAB, alive: freeBulletAlive};
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_308 playerId: %s, err : ', player._id, err);
                }
            },
            'Fish_309': async function () { // 連環炸彈蟹 範圍免費碰撞
                try {
                    randomTable = weaponAliveAlgConfig.serialBombCrabAlive[levels][data.randomConfig.RTP];       //先依levels RTP決定TABLE
                    freeBulletAlive = utils.randProbability.getRand(randomTable, 'prob', m_objRNGMethod).alive;   //依權重給免費子彈(alive)
                    logger.info(`[treasure][getTreasureByType] start add serialBombCrab. playerId: ${player._id}, bulletId: ${data.bid}, cost: ${data.cost}, config freeBulletAlive: `, freeBulletAlive);
                    if (!freeBulletAlive) freeBulletAlive = 0; // 設定檔不存在alive給0
                    return {type: consts.FishType.SERIAL_BOMB_CRAB, alive: freeBulletAlive};
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_309 playerId: %s, err : ', player._id, err);
                }
            },
            'Fish_200': async function () { // 轉盤
                try {
                    if (getMinOdds) {
                        // 取最小
                    } else {
                        odds = data.odds;
                        if (data.extraBonusOdds) {
                            // 額外觸發Bonus
                            odds = data.extraBonusOdds;
                        }
                    }

                    // 先抽TABLE 取所有賠率的值(bonus)
                    let cost = data.cost;  // 押注成本
                    // 從 bonusConfig.json 把組合丟進輪盤陣列
                    let rouletteList = _.cloneDeep(bonusConfig[fishType].odds);
                    let rouletteExList = _.cloneDeep(bonusConfig[fishType].extraOdds) || undefined;
                    let rouletteUtList = _.cloneDeep(bonusConfig[fishType].ultraOdds) || undefined;
                    let showInfo = bonusConfig[fishType][odds][Math.floor(Math.random() * bonusConfig[fishType][odds].length)];

                    let tempAry = [];
                    let count = 0;
                    let rouletteResult = undefined;
                    let rouletteExResult = undefined;
                    let rouletteUtResult = undefined;

                    //取外層
                    if (rouletteList) {
                        rouletteList = _.shuffle(rouletteList);  // 打亂陣列
                        count = rouletteList.length;
                        for (let i = 0; i < count; i++) {
                            if (rouletteList[i] == showInfo.odds)
                                tempAry.push(i);
                        }
                        rouletteResult = tempAry[Math.floor(Math.random() * tempAry.length)];
                        tempAry = [];
                    }

                    //取內層
                    if (rouletteExList) {
                        rouletteExList = _.shuffle(rouletteExList);  // 打亂陣列
                        count = rouletteExList.length;
                        for (let i = 0; i < count; i++) {
                            if (rouletteExList[i] == showInfo.extraOdds)
                                tempAry.push(i);
                        }
                        rouletteExResult = tempAry[Math.floor(Math.random() * tempAry.length)];
                        tempAry = [];
                    }

                    //取最內層
                    if (rouletteUtList) {
                        rouletteUtList = _.shuffle(rouletteUtList);  // 打亂陣列
                        count = rouletteUtList.length;
                        for (let i = 0; i < count; i++) {
                            if (rouletteUtList[i] == showInfo.ultraOdds)
                                tempAry.push(i);
                        }
                        rouletteUtResult = tempAry[Math.floor(Math.random() * tempAry.length)];
                    }

                    let amount = utils.number.multiply(odds, cost); // 獲得獎金 = 倍率 * 炮彈成本
                    return {
                        type: consts.FishType.ROULETTE,
                        amount,
                        jps: {
                            type: consts.FishType.ROULETTE,
                            amount,
                            resultList: rouletteList,
                            resultIndex: rouletteResult,
                            resultExList: rouletteExList,
                            resultExIndex: rouletteExResult,
                            resultUtList: rouletteUtList,
                            resultUtIndex: rouletteUtResult,
                            cost
                        }
                    };
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_200 , playerId: %s, data = %s, err : ', player._id, JSON.stringify(data), err);
                }
            },
            'Fish_201': async function () { // 會被額外觸發: 紅包, 金龍秘寶, 巨蚌秘寶(抽珍珠)
                try {

                    if (getMinOdds) {
                        // 取最小
                    } else {
                        odds = data.odds;
                        if (data.extraBonusOdds) {
                            // 額外觸發Bonus
                            odds = data.extraBonusOdds;
                        }
                    }

                    // 依據隨機倍率的 bonus，從 bonusConfig.json 找出任一組紅包倍率
                    let scoreList = _.cloneDeep(bonusConfig[fishType][odds]);
                    // 送給 client 的 n 個分數，根據倍率換算成分數，ex: 倍率 [50, 150, 0, 200, 100] bet=5，得到的結果會是 [250, 750, 0, 1000, 500]
                    let cost = data.cost;
                    scoreList = scoreList[Math.floor(Math.random() * scoreList.length)];
                    let count = scoreList.length;
                    for (let i = 0; i < count; i++) {
                        scoreList[i] = utils.number.multiply(scoreList[i], cost);
                    }

                    // 抽到第幾個紅包結束  [50, 150, 0, 200, 100]
                    let idx;
                    if (bonusConfig[fishType].selectCount > 0) {
                        //抽固定數
                        idx = bonusConfig[fishType].selectCount - 1;    //
                    } else {
                        //抽到0結束
                        idx = scoreList.indexOf(0);
                        if (idx === -1) { //全開出
                            idx = scoreList.length;
                        }
                    }

                    // 抽紅包獲得的奬金
                    let amount = utils.number.multiply(odds, cost);

                    return {
                        type: consts.FishType.RP,
                        amount,
                        jps: {
                            type: consts.FishType.RP,
                            amount,
                            resultList: scoreList,
                            resultIndex: idx
                        }
                    };
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_201 , playerId: %s, data = %s, err : ', player._id, JSON.stringify(data), err);
                }
            },
            'Fish_202': async function () { // 五彩秘寶
                try {
                    if (getMinOdds) {
                        // 取最小
                    } else {
                        odds = data.odds;
                        if (data.extraBonusOdds) {
                            // 額外觸發Bonus
                            odds = data.extraBonusOdds;
                        }
                    }

                    // 定義賠率組合 bonusConfig.json
                    let fiveColorsTreasure = _.cloneDeep(bonusConfig[fishType][odds]);
                    let fiveColorsTreasureData = utils.randProbability.getRand(fiveColorsTreasure, 'prob', m_objRNGMethod);
                    let sequence = fiveColorsTreasureData.vals;
                    let cost = data.cost;
                    let amount = utils.number.multiply(cost, odds);

                    let ColorArr = {
                        'Red': 10,
                        'Green': 8,
                        'Yellow': 4,
                        'Purple': 20,
                        'Blue': 8
                    };
                    for (let i in ColorArr) {
                        ColorArr[i] = utils.number.multiply(Number(ColorArr[i]), Number(cost));
                    }

                    return {
                        type: consts.FishType.FIVE_COLOR,
                        amount,
                        jps: {
                            type: consts.FishType.FIVE_COLOR,
                            amount,
                            resultList: sequence,
                            score: odds,
                            colorArr: ColorArr
                        }
                    };
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_202 , playerId: %s, data = %s, err : ', player._id, JSON.stringify(data), err);
                }
            },
            'Fish_203': async function () { // 會被額外觸發: 巨蚌秘寶(FaFaFaSlot)
                try {
                    if (getMinOdds) {
                        // 取最小
                    } else {
                        odds = data.odds;
                        if (data.extraBonusOdds) {
                            // 額外觸發Bonus
                            odds = data.extraBonusOdds;
                        }
                    }

                    // 定義賠率組合 bonusConfig.json
                    let faFaFaSlotTreasure = _.cloneDeep(bonusConfig[fishType][odds]);
                    let faFaFaSlotTreasureData = utils.randProbability.getRand(faFaFaSlotTreasure, 'prob', m_objRNGMethod);

                    // 隨機排序，送給 client 的 3 個倍率 [[0, 8, 8], [8, 8, 8], [0, 0, 8]]
                    let faFaFaSlotList = faFaFaSlotTreasureData.vals;
                    // 將送給 client 的 3 個倍率合併成各自的數字到新的陣列 [88, 888, 8]
                    let newFaFaFaSlotList = [];
                    for (let i in faFaFaSlotList) {
                        let concatArr = faFaFaSlotList[i].join('');
                        newFaFaFaSlotList.push(parseInt(concatArr));
                    }
                    // 找出陣列裡的最大值 [88, 888, 8]
                    let maxVal = Math.max.apply(null, newFaFaFaSlotList);
                    // 最大值所在 index
                    let faFaFaSlotResult = newFaFaFaSlotList.indexOf(maxVal);
                    let cost = data.cost;
                    let amount = utils.number.multiply(maxVal, cost);

                    return {
                        type: consts.FishType.GIANT_MUSSEL,
                        amount,
                        jps: {
                            type: consts.FishType.GIANT_MUSSEL,
                            amount,
                            resultList: faFaFaSlotList,
                            resultIndex: faFaFaSlotResult
                        }
                    };
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_203 , playerId: %s, data = %s, err : ', player._id, JSON.stringify(data), err);
                }
            },
            'Fish_204': async function () { // 一路發
                try {
                    if (getMinOdds) {
                        // 取最小
                    } else {
                        odds = data.odds;
                        if (data.extraBonusOdds) {
                            // 額外觸發Bonus
                            odds = data.extraBonusOdds;
                        }
                    }

                    let cost = data.cost;
                    let amount = utils.number.multiply(cost, odds);

                    let treasureConfig = _.cloneDeep(bonusConfig[fishType]);
                    let oddsList = [];
                    // 取開獎倍數清單
                    Object.keys(treasureConfig).forEach((key) => {
                        oddsList.push(key);
                    });

                    // 取開獎順序
                    treasureConfig = utils.randProbability.getRand(treasureConfig[odds], 'prob', m_objRNGMethod).vals;

                    return {
                        type: consts.FishType.YI_LU_FA,
                        amount,
                        jps: {
                            type: consts.FishType.YI_LU_FA,
                            amount,
                            score: odds,
                            resultList: treasureConfig,
                            oddsList
                        }
                    };
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_204 , playerId: %s, data = %s, err : ', player._id, JSON.stringify(data), err);
                }
            },
            'Fish_205': async function () { // 決戰黃金城
                try {
                    if (getMinOdds) {
                        // 取最小
                    } else {
                        odds = data.odds;
                        if (data.extraBonusOdds) {
                            // 額外觸發Bonus
                            odds = data.extraBonusOdds;
                        }
                    }

                    let cost = data.cost;
                    let amount = utils.number.multiply(cost, odds);

                    let treasureConfig = _.cloneDeep(bonusConfig[fishType]);
                    let oddsList = treasureConfig.odds;

                    // 取開獎順序
                    treasureConfig = utils.randProbability.getRand(treasureConfig.vals[odds], 'prob', m_objRNGMethod).vals;

                    return {
                        type: consts.FishType.GOLDEN_TREASURE,
                        amount,
                        jps: {
                            type: consts.FishType.GOLDEN_TREASURE,
                            amount,
                            score: odds,
                            resultList: treasureConfig,
                            oddsList
                        }
                    }
                } catch (err) {
                    logger.error('[treasure][getTreasureByType][dataArr][catch] Fish_205 , playerId: %s, data = %s, err : ', player._id, JSON.stringify(data), err);
                }
            }
        };
        return dataArr[fishType]();
    } catch (err) {
        logger.error('[treasure][getTreasureByType] playerId: %s, err : ', player._id, err);
    }
};
