'use strict';
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../share/constant');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('area', __filename);
let utils = require('../utils/utils');

let m_objRNGMethod;

let Controller = function (app) {
    this.app = app;
    let strRNGPath = './lib/RNG/GameLogicInterface';        // Mac Used
    // let strRNGPath = app.getBase() + '/lib/RNG/GameLogicInterface';        // Win Used
    m_objRNGMethod = utils.randProbability.loadRNGDll(strRNGPath);
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;


proto._onKillFishCheck = cort(function* (player, bullet, fishes, angles, debugData, betSetting, extraBetTime, forceNoDie) {
    try {
        const self = this;
        const areaId = player.areaId; //讀取房間ID
        // let modelArea = this.app.models.FishHunterArea; //讀取房間Schema
        // let area = yield modelArea.findByIdReadOnlyAsync(areaId);
        let killFirst = debugData.killFirst;
        let noDieFirst = debugData.noDieFirst;

        let area = self.app.controllers.fishHunterCache.findFishArea(areaId);
        if (!area) {
            self.app.controllers.debug.info('warn', '_onKillFishCheck', {
                player: player,
                bulletId: bullet.bulletId,
                fishes: fishes,
                reason: 'area not exist',
            });
            return {error: C.FISH_AREA_HAS_COMPLETED};
        }

        if (extraBetTime) {
            fishes = yield self.getExtraBetRandomAreaFishes(area, extraBetTime);
        }

        const playerId = player._id;
        const gameId = area.gameId;
        const tableLevel = area.tableLevel;
        const scene = area.scene;
        const fishTypeConfig = self.app.controllers.fishHunterConfig.getFishTypeConfig(gameId);
        const fishHunterConfig = self.app.controllers.fishHunterConfig.getGameConfig(gameId, tableLevel);
        const treasureList = fishHunterConfig.treasureList;
        const fishScore = self.app.controllers.fishHunterConfig.getFishScoreConfig(gameId);

        let gain = 0;
        let result = [];
        fishes.sort((l, r) => {
            return l - r
        });
        if (!!angles)
            angles.sort((l, r) => {
                return l - r
            });

        const areaConfig = self.app.controllers.fishHunterConfig.getFishAreaConfig(gameId, tableLevel, scene);

        for (let j = 0; j < fishes.length; j++) {
            let res = {
                bid: bullet.bulletId, chairId: bullet.chairId, success: false, die: false, cost: bullet.cost,
                fids: [], ftypes: [], score: [], typeBombs: [], treasure: [],
                totalBonus: 0,           // 計算當下的總倍數
                income: 0,              // 總贏分
                angle: undefined,       // 雷射武器同步角度用
                fishRealType: "",       // 存放鱼的原始型态
                reincarnation: "",      // [新增]再生變形功能:被打死後再生狀態變成哪種魚
                OnKillDisappear: true,  // 預設為每隻魚被殺死都會消失
                extraChainOdds: 1,      // 額外的賠率(bomb&chain)
                odds: 0,                // 原始分數(賠率)
                level: bullet.level,    // 魚被什麼子彈類型擊中(client用)
                bombTypeList: [],       // 連鎖&炸彈擊中其他魚的type列表
                avgOdds: 0,             // 平均倍數fishArea_x_x裡score的avg (風控用&機率)
                fishTemp: {},            // 暫存碰撞目標對象
                extraBonusOdds: 0,       // 額外觸發的bonus用(倍數)
            };


            let fishTemp = self.findOneAreaFishReadOnly(areaId, fishes[j]);

            if (!fishTemp) {
                this.app.controllers.debug.info('warn', '_onKillFishCheck', {
                    playerId: playerId,
                    bullet: bullet,
                    fishes: fishes,
                    gameId: gameId,
                    scene: scene,
                    reason: '玩家送不存在的FishId,給他碰撞Fish_000魚'
                });
                // 玩家用特殊手法，打到不屬於sever產生的魚時 // 給他碰撞Fish_000魚種 // fishId = 0
                fishTemp = self.findOneAreaFishReadOnly(areaId, 0);
                // fishes = [fishTemp.id];
                fishes[j] = fishTemp.id;
            }

            if (!!angles && !!angles[j]) {
                res.angle = angles[j];
            }

            res.avgOdds = fishTemp.score; // 存最原始的賠率 (avg)
            res.fishTemp = fishTemp;
            // 取得打到魚的資訊
            res = yield self.getHitFishDataInfo(fishTemp, treasureList, areaConfig, fishScore, area, res, player);

            if (!res.success) {
                this.app.controllers.debug.info('error', '_onColliderAsync', {
                    player,
                    bullet,
                    fishes,
                    area,
                    treasureList,
                    fishTemp,
                    config: areaConfig,
                    res
                });
            }
            result.push(res);
        }

        player['exchangeRate'] = betSetting.exchangeRate; // randomFishesDie subuki 換匯率用

        const rsp = [];
        for (let idx in result) {
            let res = result[idx];
            if (!res.success) {
                rsp.push({res: res, gain: res.income});
                continue;
            }

            //第一階段捕獲判定
            let randomFishesDieRes = this.app.controllers.fishHunterGame.randomFishesDie(res.hitresult, res.totalBonus, tableLevel, bullet.cost, gameId, res.fishRealType, res.fishTemp.state, player, debugData);

            res.die = randomFishesDieRes.die;
            res.randomConfig = randomFishesDieRes.randomConfig;
            res.rcCheck = randomFishesDieRes.rcCheck;

            // 風控檢查(幣別贏分上限)
            if (!killFirst) {
                res = yield self.app.controllers.subuki.checkSUBUKI_MaxReward(res, player, area, fishScore, treasureList, betSetting, areaConfig);
            }

            // 機關炮不能打死: 鑽頭炮 & 雷射炮
            if (bullet.level == consts.FishType.BAZOOKA && (res.fishRealType == consts.FishType.DRILL || res.fishRealType == consts.FishType.LASER)) {
                res.die = false;
            }
            // 鑽頭砲、電磁砲不能打死: 幾種特殊武器
            else if (bullet.level == consts.FishType.DRILL || bullet.level == consts.FishType.LASER) {
                if (fishHunterConfig.noKilltreasure.indexOf(res.fishRealType) != -1) {
                    res.die = false;
                }
            }

            // 魚種有血量制
            if (fishTypeConfig.AllFish[res.fishRealType].hpProb) {
                if (typeof (res.fishTemp.hp) != "undefined") {
                    // 扣血量
                    if (res.fishTemp.hp > 0) {
                        res.fishTemp.hp -= 1;
                    }
                    if (res.fishTemp.hp < 0) {
                        res.fishTemp.hp = 0;
                    }

                    // 血量歸0給最低賠率
                    if (res.fishTemp.hp <= 0) {
                        randomFishesDieRes.die = true;
                        res = yield self.getHitFishDataInfo(res.fishTemp, treasureList, areaConfig, fishScore, area, res, player, true);
                        logger.warn('遊戲：%s, 魚種： %s, Id: %s, 血量值 = %s, 執行第二次判定! die = %s', gameId, res.fishRealType, res.fishTemp._id, utils.number.multiply(res.hpPercent, 100), randomFishesDieRes.die);
                    }

                    // 當前血量百分比
                    res.hpPercent = utils.number.divide(res.fishTemp.hp, res.fishTemp.maxHp).toFixed(2);
                }
            }

            // 推廣帳號額外判定
            res = this.app.controllers.subuki.checkSUBUKI_PromoBAZOOKA(res, player);

            // 特殊遊戲額外判定
            // res = this.app.controllers.subuki.checkSUBUKI_FreeGame(res, player);

            // betResult callBack 尚未回來，視為打不死
            if (forceNoDie) {
                res.die = false;
            }

            if (res.die) {

                if (typeof (areaConfig.fish.ChangeSceneSet) != "undefined"
                    && typeof (areaConfig.fish.ChangeSceneSet[res.fishRealType]) != "undefined") {
                    // 取得這隻魚 死亡所需表演"死亡動畫"時間的毫秒數
                    let killShowTime = areaConfig.fish.ChangeSceneSet[res.fishRealType].OnKillShow;
                    // let rpc = self.app.rpc.fishHunter.areaRemote;
                    // // rpc 到 fishHunter 處理 area 轉場時間
                    // yield P.promisify(rpc.updateAreaSceneTimeDelay, rpc)(playerId, player.areaId, killShowTime);
                    let areaCtrl = self.app.controllers.fishHunterArea;
                    areaCtrl.updateAreaSceneTimeDelay(player.areaId, killShowTime);
                }

                // 取得不死魚被打死後的變形資料
                // if (fishTemp) // 鞭屍的魚只處理機率不做變形處理
                //   res = yield self.getReincarnation(gameId, areaId, fishTemp, fishTypeConfig, res);
                if (res.fishTemp) // 鞭屍的魚只處理機率不做變形處理
                    res = yield self.getReincarnation(gameId, areaId, res.fishTemp, fishTypeConfig, res);

                // 該隻魚如果不是不死魚
                if (res.OnKillDisappear == true) {
                    res.fishTemp.born = 0;
                    // yield res.fishTemp.saveAsync();
                }

                // 定義打死魚後觸發其他bonus
                res = yield self.getExtraBonus(gameId, res, fishTypeConfig, areaConfig, tableLevel, bullet, player, area, treasureList, killFirst);

                // 處理額外死掉的魚 born = 0
                if (res.typeBombs.length > 0) {
                    let allFishIds = [];
                    allFishIds = allFishIds.concat(res.fids);

                    self.removeAllDeadFishes(areaId, allFishIds, fishes, player.gameServerId);

                    res.fids = res.typeBombs;
                } else {
                    res.fids = [fishes[idx]];
                }

                // 集寶器判斷
                res = yield self.checkLuckyDraw(player, gameId, res, bullet);

                res.income = utils.number.multiply(res.totalBonus, res.cost, res.extraChainOdds);
            } else {
                res.fids = [fishes[idx]];
                res.score = [];       // bomb&chain: 魚沒死就不傳分數
                res.typeBombs = [];   // bomb&chain: 魚沒死就不傳打中的其他魚
                res.bombTypeList = [];// bomb&chain: 魚沒死就不傳打中的其他魚type
                res.treasure = [];    // 魚沒死不放 treasure

                // 定義沒打中魚時有機會觸發額外Bonus
                res = yield self.getNoDieBonus(gameId, res, fishTypeConfig, areaConfig, area, treasureList, tableLevel, noDieFirst, betSetting);
            }
            // res.income = utils.number.multiply(res.totalBonus, res.cost, res.extraChainOdds);
            gain = utils.number.add(gain, res.income);

            // extraBetTime
            if (extraBetTime)
                res.isExtraBet = true;

            rsp.push({res: res, gain: res.income, scene: scene});  //  回傳data增加scene
        }

        this.app.controllers.debug.info('info', '_onKillFishCheck', {
                playerId: player._id,
                areaId: player.areaId,
                bulletId: bullet.bulletId,
                fishes: fishes,
                rsp: rsp
            }
        );

        return {error: null, data: rsp};
    } catch (err) {
        logger.error('[colliderService][_onKillFishCheck] player: %s, bullet: %s, fishes: %s, err: ',
            JSON.stringify(player), JSON.stringify(bullet), fishes, err);
    }
});

proto.getFishResetInfo = function (res) {
    try {
        res.ftypes = [];
        res.fids = [];
        res.score = [];
        res.odds = 0;
        res.treasure = [];
        delete res.pauseTime;
        return res;
    } catch (err) {
        logger.error('[colliderService][getFishResetInfo] res: %s, err: ', JSON.stringify(res), err);
    }
};


// 取得打到魚的資訊
proto.getHitFishDataInfo = cort(function* (fishTemp, treasureList, areaConfig, fishScore, area, res, player, getMinOdds) {
    try {
        const self = this;
        let data;
        let chainAlgConfig;

        switch (fishTemp.state) {
            case consts.FishState.TEAM:
                self.getFishDefaultInfo(fishTemp, res, fishScore, getMinOdds);
                return res;
            case consts.FishState.CHAIN:
            case consts.FishState.FLASH:
            case consts.FishState.METEOR:
            case consts.FishState.FLASH_SHARK:
            case consts.FishState.WAKEN:
                // 取額外倍數
                let fs;

                if (fishTemp.state !== consts.FishState.FLASH_SHARK) { // FLASH_SHARK 沒有隨機倍數不用取
                    switch (fishTemp.state) {
                        case consts.FishState.CHAIN:// 連鎖閃電 場上同類必死
                            fs = fishScore[consts.FishType.CHAIN];
                            break;
                        case consts.FishState.FLASH:// 放射閃電 隨機找N隻必死（100倍以下）
                            fs = fishScore[consts.FishType.FLASH];
                            break;
                        case consts.FishState.METEOR:// 流星雨   場上同類必死（100倍以下）
                            fs = fishScore[consts.FishType.METEOR];
                            break;
                        case consts.FishState.WAKEN:// 覺醒 以總分推算捕獲場上魚隻
                            fs = fishScore[consts.FishType.WAKEN];
                            break;
                        default:
                            logger.error('[getHitFishDataInfo] UNKNOW fishTemp.state');
                            break;
                    }
                    if (!fs) {
                        return res;
                    }

                    // let randomTable = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod);
                    // let randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
                    let randomScore = utils.randProbability.getFSRand(fs, m_objRNGMethod, getMinOdds);

                    // 額外倍數
                    res.extraChainOdds = randomScore.bonus;
                }

                // 先取魚本身的倍數
                self.getFishDefaultInfo(fishTemp, res, fishScore, getMinOdds);

                /*== 處理其他連鎖的魚 ==*/
                chainAlgConfig = this.app.controllers.fishHunterConfig.getChainAlgConfig(area.gameId);
                const paramDefinConf = this.app.controllers.fishHunterConfig.getParamDefinConfig();
                switch (fishTemp.state) {
                    case consts.FishState.CHAIN:// 連鎖閃電 場上同類必死
                    case consts.FishState.METEOR:// 流星雨  全場必死（100倍以下）
                        data = yield self.getMustDieFishesByChain(area, fishTemp, res.extraChainOdds, res.cost, fishScore, (fishTemp.state == consts.FishState.CHAIN), chainAlgConfig, getMinOdds);
                        break;
                    case consts.FishState.FLASH:// 放射閃電 隨機找N隻必死（100倍以下）
                        data = yield self.getMustDieFishesByFlash(area, fishTemp, res.extraChainOdds, res.cost, fishScore, chainAlgConfig, paramDefinConf.weapon, getMinOdds);
                        break;
                    case consts.FishState.FLASH_SHARK:// 閃電魚   隨機找N隻必死（100倍以下）
                        data = yield self.getMustDieFishesByFlash(area, fishTemp, 1, res.cost, fishScore, chainAlgConfig, paramDefinConf.weapon, getMinOdds);
                        break;
                    case consts.FishState.WAKEN:// 覺醒 以總分推算捕獲場上魚隻
                        data = yield self.getMustDieFishesByWaken(area, fishTemp, res.extraChainOdds, res.cost, fishScore, chainAlgConfig, res.odds, paramDefinConf.weapon, getMinOdds);
                        break;
                }

                res.typeBombs = res.fids.concat(data.ids);
                res.fids = res.fids.concat(data.ids);
                res.score = res.score.concat(data.score);
                res.bombTypeList = data.typeList; // 連鎖擊中其他魚的type列表(不含被擊中的那隻)
                res.totalBonus = utils.number.add(res.totalBonus, data.totalBonus); // 打中那隻加上連鎖擊中其他魚的總倍數

                //計算特殊機率
                let cache = this.app.controllers.fishHunterCache;
                let levels = _.cloneDeep(cache.getFishAlgArgs(player, player.tableLevel));
                // if (!levels) levels = cache.getFishAlgArgs(area.gameId);
                if (!levels) levels = 'normal';
                //先抽不同levels的chain_rtp TABLE
                let randomChainrtpTable = utils.randProbability.getRand(chainAlgConfig.chain_rtp[levels], 'weight', m_objRNGMethod);
                //再抽不同TABLE的rtp
                let randomRTP = utils.randProbability.getRand(randomChainrtpTable.vals, 'prob', m_objRNGMethod).rtp;
                // 計算 hitresult
                switch (fishTemp.state) {
                    case consts.FishState.CHAIN:// 連鎖閃電 場上同類必死
                    case consts.FishState.METEOR:// 流星雨   場上同類必死（100倍以下）
                    case consts.FishState.WAKEN:// 覺醒 以總分推算捕獲場上魚隻
                        res.hitresult = utils.number.divide(randomRTP, res.totalBonus);
                        break;
                    case consts.FishState.FLASH:// 放射閃電 隨機找N隻必死（100倍以下）
                    case consts.FishState.FLASH_SHARK:// 閃電魚   隨機找N隻必死（100倍以下）
                        let hitrate = utils.number.divide(randomRTP, res.totalBonus);
                        //先抽不同levels的mortalityrate TABLE
                        let obj = chainAlgConfig.mortalityrate[levels];
                        if (!obj)
                            obj = chainAlgConfig.mortalityrate["normal"];
                        let randomMortalityrateTable = utils.randProbability.getRand(obj, 'tabprob', m_objRNGMethod);
                        let randomMortalityrate = utils.randProbability.getRand(randomMortalityrateTable.vals, 'prob', m_objRNGMethod).rate;
                        res.hitresult = utils.number.workMultiply(hitrate, randomMortalityrate);
                        break;
                }
                return res;
            default:
                self.getFishDefaultInfo(fishTemp, res, fishScore, getMinOdds);
                self.checkTreasure(fishTemp, areaConfig, treasureList, res);
                return res;
        }
    } catch (err) {
        logger.error('[colliderService][getHitFishDataInfo] player: %s, res: %s, err: ', JSON.stringify(player), JSON.stringify(res), err);
    }
});

proto.fishfilter = function (fishAry, ...conditions) {
    try {
        while (conditions.length > 0) {
            let condition = conditions.shift();
            fishAry = fishAry.filter((fish) => fish.type.indexOf(condition) == -1);
        }
        return fishAry;
    } catch (err) {
        logger.error('[colliderService][fishfilter] err: ', err);
        return null;
    }
}

// 連鎖閃電 場上同類必死（100倍以下）
// 流星雨 全場必死（100倍以下）
proto.getMustDieFishesByChain = cort(function* (area, fishTemp, extraChainOdds, cost, fishScore, isSame, chainAlgConfig, getMinOdds) {
    try {
        let self = this;
        let scoreList = [];
        let idList = [];
        let typeList = [];
        let areaId = area._id;
        const hitFishType = fishTemp.type;
        // let modelAreaFishes = self.app.models.FishHunterAreaFishes;
        let areaCtrl = self.app.controllers.fishHunterArea;
        let totalBonus = 0;

        // 取場上同種魚
        // let fishId_arr = yield modelAreaFishes.findAsync({areaId: areaId, type: hitFishType});
        let searchData = {areaId: areaId};
        if (isSame) {
            searchData.type = hitFishType;
        }
        // let fishId_arr = yield modelAreaFishes.findAsync(searchData);
        let fishId_arr = areaCtrl.searchFish(areaId, searchData);

        // 過濾 獎勵遊戲魚種、武器魚種
        fishId_arr = self.fishfilter(fishId_arr, consts.FishType.BONUS, consts.FishType.WEAPON);

        let score = 0;
        let fs = null;
        // let randomTable = null;
        let randomScore = 0;

        // 亂數排序
        fishId_arr = utils.randProbability.randomSort(fishId_arr);

        for (let fish of fishId_arr) {
            if (fish.born <= 0 || fish.id == 0 || fish.id == fishTemp.id) continue; // 跳過魚已死亡 或 第0隻 或 被擊中的那隻魚
            if (fish.born + (fish.alive * 1000) < area.updateTime) continue; // 魚存活時間 < 魚場最新時間 = 魚已離開場外
            fs = fishScore[fish.type];
            if (!fs) continue;//logger.error('fish score config error ',fish.type,' fishScore ',fishScore);

            // randomTable = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod);//先抽TABLE
            // randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
            randomScore = utils.randProbability.getFSRand(fs, m_objRNGMethod, getMinOdds);


            if (!!randomScore) {
                if (randomScore.bonus > chainAlgConfig.maxOdd) continue; // 超過限制賠率跳過該魚
                totalBonus = utils.number.add(totalBonus, randomScore.bonus);
                score = utils.number.multiply(randomScore.bonus, extraChainOdds, cost);
                scoreList.push(score);
                idList.push(fish.id);
                typeList.push({type: fish.type, odds: randomScore.bonus});
            }
        }
        return {score: scoreList, ids: idList, totalBonus: totalBonus, typeList};
    } catch (err) {
        logger.error('[colliderService][getMustDieFishesByChain] fishTemp: %s, extraChainOdds: %s, err: ', JSON.stringify(fishTemp), extraChainOdds, err);
    }
});

// 放射閃電 隨機找N隻必死（100倍以下）
proto.getMustDieFishesByFlash = cort(function* (area, fishTemp, extraChainOdds, cost, fishScore, chainAlgConfig, weaponList, getMinOdds) {
    try {
        let self = this;
        let scoreList = [];
        let idList = [];
        let typeList = [];
        let areaId = area._id;
        // let modelAreaFishes = self.app.models.FishHunterAreaFishes;
        let areaCtrl = self.app.controllers.fishHunterArea;
        let totalBonus = 0;

        // 取場上所有魚
        //yield modelAreaFishes.findAsync({areaId: areaId});
        let fishId_arr = areaCtrl.searchFish(areaId, {areaId: areaId});

        // 過濾 獎勵遊戲魚種、武器魚種
        fishId_arr = self.fishfilter(fishId_arr, consts.FishType.BONUS, consts.FishType.WEAPON);

        let score = 0;
        let fs = null;
        // let randomTable = null;
        let randomScore = 0;
        let Lambda = utils.randProbability.getRand(chainAlgConfig.Lambda, 'weight', m_objRNGMethod);
        let DieCount = utils.randProbability.getRand(Lambda.vals, 'prob', m_objRNGMethod).count;
        let count = 0;

        // 亂數排序
        fishId_arr = utils.randProbability.randomSort(fishId_arr);

        for (let fish of fishId_arr) {
            if (fish.born <= 0 || fish.id == 0 || fish.id == fishTemp.id) continue; // 跳過魚已死亡 或 第0隻 或 被擊中的那隻魚
            if (fish.born + (fish.alive * 1000) < area.updateTime) continue; // 魚存活時間 < 魚場最新時間 = 魚已離開場外
            if (weaponList.indexOf(fish.type) > -1) continue; // 過濾特殊武器
            if (count >= DieCount) break;
            fs = fishScore[fish.type];
            if (!fs) continue;//logger.error('fish score config error ',fish.type,' fishScore ',fishScore);
            count++;

            // randomTable = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod);//先抽TABLE
            // randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
            randomScore = utils.randProbability.getFSRand(fs, m_objRNGMethod, getMinOdds);
            if (!!randomScore) {
                if (randomScore.bonus > chainAlgConfig.maxOdd) continue; // 超過限制賠率跳過該魚
                totalBonus = utils.number.add(totalBonus, randomScore.bonus);
                score = utils.number.multiply(randomScore.bonus, extraChainOdds, cost);
                scoreList.push(score);
                idList.push(fish.id);
                typeList.push({type: fish.type, odds: randomScore.bonus});
            }
        }
        return {score: scoreList, ids: idList, totalBonus: totalBonus, typeList};
    } catch (err) {
        logger.error('[colliderService][getMustDieFishesByChain] fishTemp: %s, extraChainOdds: %s, err: ', JSON.stringify(fishTemp), extraChainOdds, err);
    }
});

// 覺醒 以總分推算捕獲場上魚隻
proto.getMustDieFishesByWaken = cort(function* (area, fishTemp, extraChainOdds, cost, fishScore, chainAlgConfig, hitFishOdds, weaponList, getMinOdds) {
    try {
        let self = this;
        let scoreList = [];
        let idList = [];
        let typeList = [];
        let areaId = area._id;
        // let modelAreaFishes = self.app.models.FishHunterAreaFishes;
        let areaCtrl = self.app.controllers.fishHunterArea;
        // 總分 = 魚賠率＊額外賠率＊押注
        let totalBonus = utils.number.multiply(hitFishOdds, extraChainOdds);
        let extraBonus = utils.number.sub(totalBonus, hitFishOdds);

        // 取場上所有魚
        let fishId_arr = areaCtrl.searchFish(areaId, {areaId: areaId});//yield modelAreaFishes.findAsync({areaId: areaId});

        // 過濾 獎勵遊戲魚種、武器魚種
        fishId_arr = self.fishfilter(fishId_arr, consts.FishType.BONUS, consts.FishType.WEAPON);

        let score = 0;
        let fs = null;
        // let randomTable = null;
        let randomScore = 0;

        // 表演死亡數取場上一半就好
        let DieCount = Math.floor(utils.number.multiply(fishId_arr.length, 2));
        let count = 0;

        // 亂數排序
        fishId_arr = utils.randProbability.randomSort(fishId_arr);

        for (let fish of fishId_arr) {
            if (fish.born <= 0 || fish.id == 0 || fish.id == fishTemp.id) continue; // 跳過魚已死亡 或 第0隻 或 被擊中的那隻魚
            if (fish.born + (fish.alive * 1000) < area.updateTime) continue; // 魚存活時間 < 魚場最新時間 = 魚已離開場外
            if (weaponList.indexOf(fish.type) > -1) continue; // 過濾特殊武器
            if (count >= DieCount) break;
            fs = fishScore[fish.type];
            if (!fs) continue;//logger.error('fish score config error ',fish.type,' fishScore ',fishScore);

            // randomTable = utils.randProbability.getRand(fs.vals,'tabprob', m_objRNGMethod);//先抽TABLE
            // randomScore = utils.randProbability.getRand(randomTable.tabvals,'prob', m_objRNGMethod);
            randomScore = utils.randProbability.getFSRand(fs, m_objRNGMethod, getMinOdds);
            if (!!randomScore) {
                if (randomScore.bonus > chainAlgConfig.maxOdd) continue; // 超過限制賠率跳過該魚
                score = utils.number.multiply(randomScore.bonus, cost);
                if (totalBonus < randomScore.bonus) break;
                totalBonus -= randomScore.bonus;
                count++;

                scoreList.push(score);
                idList.push(fish.id);
                typeList.push({type: fish.type, odds: randomScore.bonus});
            }
        }
        return {score: scoreList, ids: idList, totalBonus: extraBonus, typeList};
    } catch (err) {
        logger.error('[colliderService][getMustDieFishesByWaken] fishTemp: %s, extraChainOdds: %s, err: ', JSON.stringify(fishTemp), extraChainOdds, err);
    }
});

proto.getExtraBetRandomAreaFishes = cort(function* (area, extraBetTime) {
    try {
        let self = this;
        let res = [];

        // 取場上所有魚
        let areaId = area._id;
        let fishId_arr = self.app.controllers.fishHunterArea.searchFish(areaId, {areaId: areaId});
        // 過濾 fish.id == 0
        let fish0 = fishId_arr.filter((a) => {
            return a.id == 0;
        });
        // 過濾 fish.id == 0 , 死掉和離場的魚
        fishId_arr = fishId_arr.filter((a) => {
            return a.id != 0 && a.born > 0 && a.born + (a.alive * 1000) >= area.updateTime;
        });
        let arrCount = fishId_arr.length;

        // 亂數排序
        fishId_arr = utils.randProbability.randomSort(fishId_arr);

        // 抽取
        let fish, ranIdx;
        for (let i = 0; i < extraBetTime; i++) {
            if (i <= arrCount - 1) {
                // 場上足夠，直接取
                fish = fishId_arr[i];
            } else {
                // 場上不夠
                if (arrCount > 0) {
                    // 還有就重複抓
                    let min = 1;
                    let max = arrCount - 1;
                    ranIdx = Math.floor(1 + Math.random() * (max - min));
                    fish = fishId_arr[ranIdx];
                } else {
                    // 完全沒有，抓o號
                    fish = fish0[0];
                }
            }
            res.push(fish.id)
        }

        return res;
    } catch (err) {
        logger.error('[colliderService][getExtraBetRandomAreaFishes] err: ', err);
    }
});

// 取得魚被打死後的變身資料
proto.getReincarnation = cort(function* (gameId, areaId, fishTemp, fishTypeConfig, res) {
    try {
        let self = this;
        let ret = fishTypeConfig.AllFish[fishTemp.type].OnKillDisappear; // 取設定檔該隻魚設定為不死魚
        if (ret == false) {
            res.OnKillDisappear = false;//設定為被殺後不消失=不死魚
            //取設定檔，取看看該魚種有沒有設定變身 有的話回傳給前端 功能用途舉例: "五龍1"打死後魚種變成"五龍2"
            // let getReincarnationStatus = fishTypeConfig.AllFish[fishTemp.type].reincarnation;
            let getReincarnationStatus;
            if (fishTypeConfig.AllFish[fishTemp.type].reincarnation) {
                // 沒有reincarnationProb 或 觸發reincarnationProb 就變身
                if (!fishTypeConfig.AllFish[fishTemp.type].reincarnationProb
                    || fishTypeConfig.AllFish[fishTemp.type].reincarnationProb <= 0
                    || utils.randProbability.getRangeHit(0, 100, fishTypeConfig.AllFish[fishTemp.type].reincarnationProb)) {
                    getReincarnationStatus = fishTypeConfig.AllFish[fishTemp.type].reincarnation;
                }
            }
            res.reincarnation = "";
            if (typeof (getReincarnationStatus) == "string") {
                res.reincarnation = getReincarnationStatus;
                //在AreaFish将该鱼变更Type 成 reincarnation新的Type
                yield self.updateAreaFish(areaId, fishTemp.id, {type: getReincarnationStatus});
            }
        }
        return res;
    } catch (err) {
        logger.error('[colliderService][getReincarnation] res: %s, err: ', JSON.stringify(res), err);
    }
});

proto.getFishDefaultInfo = function (fishTemp, res, fishScore, getMinOdds) {
    try {
        res.success = true;
        res.ftypes.push(fishTemp.type + '|' + fishTemp.state);
        res.state = fishTemp.state;
        res.fishRealType = fishTemp.type;
        res.fids.push(fishTemp.id);

        let fs = fishScore[fishTemp.type];
        if (!fs) {
            logger.error('[colliderService][getFishDefaultInfo] fish score config error ', fishTemp.type, ' config ', fishScore, ' res: ', JSON.stringify(res));
            return res;
        }

        // let randomTable;
        let randomScore;
        let fishBonus = 0;

        randomScore = utils.randProbability.getFSRand(fs, m_objRNGMethod, getMinOdds);
        if (!!randomScore) fishBonus = randomScore.bonus;

        res.score.push(utils.number.multiply(fishBonus, res.cost, res.extraChainOdds));
        res.totalBonus = fishBonus;
        res.odds = fishBonus; // 存random完的賠率

        return res;
    } catch (err) {
        logger.error('[colliderService][getFishDefaultInfo] fishTemp: %s, res: %s, err: ', JSON.stringify(fishTemp), JSON.stringify(res), err);
    }
};

proto.checkTreasure = function (fishTemp, areaConfig, treasureList, res) {
    try {
        if (fishTemp.type == consts.FishType.ICE) { // 冰凍炸彈
            res.pauseTime = areaConfig.scene.PAUSE_SCREEN_TIME_DELAY || 5000;
        } else if (treasureList.indexOf(fishTemp.type) !== -1) { // 檢查type是否為 => 武器/轉盤/紅包
            res.treasure.push(fishTemp.type);
        }
        return res;
    } catch (err) {
        logger.error('[colliderService][checkTreasure] fishTemp: %s, res: %s, err: ', JSON.stringify(fishTemp), JSON.stringify(res), err);
    }
};

// 定義打死魚後觸發其他bonus // 10002、10003的fishType.json
// 不支援打死bonus後觸發其他bonus
proto.getExtraBonus = cort(function* (gameId, res, fishTypeConfig, areaConfig, tableLevel, bullet, player, area, treasureList, killFirst) {
    try {
        // 風控檢查(未捕獲觸發或額外觸發)
        if (!this.app.controllers.subuki.checkSUBUKI_ExtraTrigger(res, gameId) && !killFirst) {
            return res;
        }

        //取得该鱼是否有触发bomus 如:触发drill子弹
        let fishType = res.fishRealType;
        let extraBonus = fishTypeConfig.AllFish[fishType].extraBonus;
        if (extraBonus) {
            let extraBonusAlgConf = this.app.controllers.fishHunterConfig.getExtraBonusAlgConfig(gameId);

            //先抽有沒有觸發
            let randomResult = utils.randProbability.getRand(extraBonusAlgConf.extraBonus, 'triggerprob', m_objRNGMethod);

            //擋測試模式才可使用
            if (killFirst)
                if (this.app.get('env') == 'development') {
                    while (!randomResult || !randomResult.tabvals || randomResult.tabvals.length <= 0) {
                        randomResult = utils.randProbability.getRand(extraBonusAlgConf.extraBonus, 'triggerprob', m_objRNGMethod);
                    }
                }

            if (randomResult != null && randomResult.tabvals && randomResult.tabvals.length > 0) {
                //抽要觸發哪種bonus
                randomResult = utils.randProbability.getRand(randomResult.tabvals, 'triggerprob', m_objRNGMethod);

                //擋測試模式才可使用
                if (killFirst)
                    if (this.app.get('env') === 'development') {
                        while (!randomResult || !randomResult.bonusType || !randomResult.val) {
                            randomResult = utils.randProbability.getRand(randomResult.tabvals, 'triggerprob', m_objRNGMethod);
                        }
                    }

                if (randomResult != null && randomResult.bonusType && randomResult.val) {
                    let bonusType = randomResult.bonusType;
                    let cache = this.app.controllers.fishHunterCache;
                    let levels = _.cloneDeep(cache.getFishAlgArgs(player, tableLevel));
                    // if (!levels) levels = cache.getFishAlgArgs(gameId);
                    if (!levels) levels = 'normal';

                    //抽要哪個level的TABLE
                    let randomTable = utils.randProbability.getRand(randomResult.val[levels], 'tabprob', m_objRNGMethod);
                    if (randomTable) {
                        //抽倍數結果
                        randomTable = utils.randProbability.getRand(randomTable.tabvals, 'prob', m_objRNGMethod);
                        let randomScore = randomTable.val;

                        // ------- 風控檢查(額外觸發) ---------------------------------------------
                        let _res = _.cloneDeep(res);
                        let income = utils.number.multiply(randomScore, res.cost);
                        if (!!_res.rcCheck && !!_res.rcCheck.check && _res.rcCheck.check.hasOwnProperty('totalGain')) {
                            _res.rcCheck.check.totalGain = utils.number.add(_res.rcCheck.check.totalGain, income);
                            if (!this.app.controllers.subuki.checkSUBUKI_ExtraTrigger(_res, gameId) && !killFirst) {
                                res.die = false;
                                return res;
                            }
                        } else {
                            logger.error(`[colliderService][getExtraBonus] playerId: ${player._id}, gameId: ${gameId}, bonusType: ${bonusType}, res: ${JSON.stringify(res)}, not find totalGain. rcCheck: `, _res.rcCheck);
                            res.die = false;
                            return res; // 吃掉結果
                        }
                        // ---------------------------------------------------------------------

                        res.treasure.push(bonusType);
                        res.extraBonusOdds = randomScore;

                        logger.info('[colliderService][getExtraBonus] trigger ExtraBonus!!!!! res: ', res);
                    }
                }
            }
        }
        return res;
    } catch (err) {
        logger.error('[colliderService][getExtraBonus] res: %s, err : ', JSON.stringify(res), err);
    }
});

// 檢查打死魚後是否獲得集寶器搜集物件
proto.checkLuckyDraw = cort(function* (player, gameId, res, bullet) {
    try {
        let self = this;
        let collectionDrawConfig = self.app.controllers.fishHunterConfig.getCollectionDrawConfig(gameId);

        // 有無config
        if (collectionDrawConfig) {

            // 是否為可收集的魚種
            if (collectionDrawConfig.collectionType.indexOf(res.fishRealType) > -1) {

                // 取集寶器紀錄
                let modelCollection = self.app.models.CollectionHistory;
                let collectionId = modelCollection.getId(player._id, player.gameId);
                let collection = yield modelCollection.findByIdAsync(collectionId);

                // 檢查收集紀錄
                if (!collection) {
                    collection = new modelCollection({
                        _id: collectionId,
                        playerId: player._id,
                        gameId: player.gameId,
                        bulletId: bullet.bulletId,
                        cost: bullet.cost,
                        shootType: bullet.shootType,
                    });
                }

                // 增加次數
                collection.count += 1;
                // 紀錄子彈Id
                collection.bulletId = bullet.bulletId;
                // 更新 cost
                collection.cost = bullet.cost;
                // 更新武器種類
                collection.shootType = bullet.shootType;

                res.luckyDraw = {       // 幸運抽獎
                    trigger: false,  // 是否觸發
                    count: 0,      // 進度
                    fixedOdds: 0,      // 固定倍數
                };

                // 是否集滿
                if (collection.count < collectionDrawConfig.collectionCount) {
                    // 未集滿
                    res.luckyDraw.count = collection.count;
                    delete res.luckyDraw.fixedOdds;
                } else {
                    // 集滿(超過吃掉)
                    res.luckyDraw.trigger = true;
                    collection.count = collectionDrawConfig.collectionCount;
                    res.luckyDraw.count = collection.count;
                    res.luckyDraw.fixedOdds = collectionDrawConfig.collectionAvgOdds;

                    let cache = this.app.controllers.fishHunterCache;
                    let levels = _.cloneDeep(cache.getFishAlgArgs(player, player.tableLevel));
                    // if (!levels) levels = cache.getFishAlgArgs(gameId);
                    if (!levels) levels = 'normal';
                    collection.levels = levels;
                }
                yield collection.saveAsync();
            }
        }
        return res;
    } catch (err) {
        logger.error('[colliderService][checkLuckyDraw] player: %s, gameId: %s, res: %s, bullet: %s, err : ', JSON.stringify(player), gameId, JSON.stringify(res), JSON.stringify(bullet), err);
    }
});

// 定義沒打中魚時有機會觸發額外Bonus
proto.getNoDieBonus = cort(function* (gameId, res, fishTypeConfig, areaConfig, area, treasureList, tableLevel, noDieFirst, betSetting) {
    try {
        // 風控檢查(未捕獲觸發或額外觸發)
        if (!this.app.controllers.subuki.checkSUBUKI_ExtraTrigger(res, gameId))
            return res;

        let noDieBonusId = fishTypeConfig.NoDieBonus;
        if (res.randomConfig.noDie && noDieBonusId) {

            let counter = 10000000;
            let prob = res.randomConfig.noDie[0].prob * counter;
            prob = _.round(prob, 0);
            let alive = utils.number.sub(counter, prob);
            if (alive < 0) alive = 0;
            let arr = [
                {"prob": prob, result: 1},
                {"prob": alive, result: 0}
            ];

            let randomTable;
            let totalOdds = 0;

            // noDieFirst判斷
            if (noDieFirst) {
                randomTable = utils.randProbability.getRand(res.randomConfig.noDie[0].pay, 'weight', m_objRNGMethod);
                totalOdds = randomTable.val;
                res.treasure.push(noDieBonusId);
                res.extraBonusOdds = totalOdds;
                logger.info('[colliderService][getNoDieBonus] trigger NoDieBonus!!!!! res: ', res);
                return res;
            }

            // 檢查betSetting
            if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
                logger.error(`[colliderService][getNoDieBonus] no betSetting! playerId: ${player._id}`);
                return res;
            }

            // 檢查有無機會中noDie
            let ranRes = utils.randProbability.getRand(arr, 'prob', m_objRNGMethod);
            if (ranRes.result > 0) {

                let i = 0;
                // 檢查幣別贏分或限定倍數上限
                let maxReward = betSetting.maxReward;
                let tempReward = 0;
                while ((tempReward > maxReward || tempReward == 0 || (totalOdds > consts.MAX_ODDS && consts.MAX_ODDS > 0)) && i < 10) {
                    randomTable = utils.randProbability.getRand(res.randomConfig.noDie[0].pay, 'weight', m_objRNGMethod);
                    totalOdds = randomTable.val;
                    i++;
                    tempReward = utils.number.multiply(res.cost, totalOdds);
                }

                if (i >= 10) {
                    logger.warn('[colliderService][getNoDieBonus] 重RAN後超過幣別贏分或限定倍數上限，吃掉結果 !!! : player: %s, res: %s', player, res);
                    // logger.error('[subuki][getNoDieBonus] 重RAN後超過幣別贏分或限定倍數上限，吃掉結果 !!! : player: %s, res: %s', player, res);
                    // logger.fatal('[subuki][getNoDieBonus] 重RAN後超過幣別贏分或限定倍數上限，吃掉結果 !!! : player: %s, res: %s', player, res);
                    return res;
                } else {
                    res.treasure.push(noDieBonusId);
                    res.extraBonusOdds = totalOdds;
                    logger.info('[colliderService][getNoDieBonus] trigger NoDieBonus!!!!! res: ', res);
                }
            }
        }
        return res;
    } catch (err) {
        logger.error('[colliderService][getNoDieBonus] res: %s, err : ', JSON.stringify(res), err);
    }
});


proto.findOneAreaFishReadOnly = function (areaId, fishId) {
    try {
        let areaCtrl = this.app.controllers.fishHunterArea;
        let id = areaId + fishId;

        return areaCtrl.getFishData(areaId, id);
        // return this.app.models.FishHunterAreaFishes.findByIdReadOnlyAsync(areaId + fishId);
    } catch (err) {
        logger.error('[colliderService][findOneAreaFishReadOnly] areaId: %s, fishId: %s, err: ', areaId, fishId, err);
    }
};

proto.removeAllDeadFishes = cort(function* (areaId, deadFishes, exceptFishes, shardId) {
    let self = this;

    return self.app.memdb.goose.transactionAsync(cort(function* () {
        for (let i = 0; i < deadFishes.length; i++) {
            for (let j = 0; j < exceptFishes.length; j++) {
                if (deadFishes[i] == exceptFishes[j] && deadFishes[i] != 0) {
                    deadFishes[i] = 0;
                }
            }
        }

        deadFishes.sort((l, r) => {
            return l - r
        });

        for (let i = 0; i < deadFishes.length; i++) {
            if (deadFishes[i] != 0) {
                let bSuccess = yield self.updateAreaFish(areaId, deadFishes[i], {born: 0});

                if (!bSuccess) {
                    //logger.error('removeAllDeadAreaFish error ', areaId, ' fishId ', deadFishes[idx]);
                }
            }
        }

    }), shardId)
        .then(() => {
            self.app.event.emit('transactionSuccess')
        })
        .catch((err) => {
            logger.error('[colliderService][removeAllDeadFishes] deadFishes: %s, err: ', JSON.stringify(deadFishes), err);
            self.app.event.emit('transactionFail');
        });
});

proto.updateAreaFish = cort(function* (areaId, fishId, opts) {
    try {
        // let temp = yield this.app.models.FishHunterAreaFishes.findByIdAsync(areaId + fishId);
        // if (!!temp) {
        //   for (let o in opts) {
        //     temp[o] = opts[o];
        //   }
        //   yield temp.saveAsync();
        // }
        //
        // return temp;

        let id = areaId + fishId;
        let areaCtrl = this.app.controllers.fishHunterArea;

        return areaCtrl.updateFish(areaId, id, opts);
    } catch (err) {
        logger.error('[colliderService][updateAreaFish] areaId: %s, fishData: %s, err: ', areaId, JSON.stringify(opts), err);
    }
});

proto.checkScreenPause = cort(function* (result, player) {
    try {
        for (let idx in result.data) {
            let res = result.data[idx].res;

            if (res.die) {
                if (!res.pauseTime) {
                    continue;
                }

                yield this.screenPause(player.areaId, res.pauseTime, player.gameServerId);
                break;
            }
        }

        return result;
    } catch (err) {
        logger.error('[colliderService][checkScreenPause] playerId: %s, result: %s, err: ', player._id, JSON.stringify(result), err);
    }
});

proto.screenPause = cort(function* (areaId, pauseDelta, areaServerId) {
    try {
        let self = this;

        let area = self.app.controllers.fishHunterCache.findFishArea(areaId);
        if (!!area) {
            let now = Date.now();
            // 冰凍暫停時間: 不累加&不更新 該魚場暫停時間
            if (now - area.pauseTime < pauseDelta) return;
            area.pauseTime = now;
            if (!area.hasOwnProperty('pauseRange')) area.pauseRange = 0; // 初始化
            area.pauseRange += pauseDelta; // 加總漁場總共暫停多久毫秒
        }

    } catch (err) {
        logger.error('[colliderService][screenPause] areaId: %s, err: ', areaId, err);
    }
});

proto._onColliderAsync = cort(function* (player, bullet, result) {
    try {
        if (!!result.error) {
            return result;
        }
        const self = this;
        const playerId = player._id;
        const tableId = player.tableId;
        const gameId = player.gameId;

        const rsp = [];          // 回傳給子單處理的資料
        const colliderData = []; // push給前端的碰撞資料
        const highOddsData = []; // 高賠率廣播用的資料

        for (let idx in result.data) {
            let res = result.data[idx].res;   // 碰撞結果
            let gain = result.data[idx].gain; // 玩家該次碰撞獲得的總彩金
            let haveTreasure = false;
            if (Object.keys(res.treasure).length > 0) {
                haveTreasure = true;
            }

            // 單錢包
            // switch (player.isSingleWallet) {
            //   case consts.walletType.singleWallet:
            //     // 鑽頭炮 & 雷射炮 & 機關炮 先 call bet 0
            //     if (bullet.shootType == consts.FishType.DRILL || bullet.shootType == consts.FishType.LASER || bullet.shootType == consts.FishType.BAZOOKA) {
            //       let betRes = yield self.app.controllers.fishHunterPlayer.callBet(player, 0, bullet);
            //       if (betRes.code !== C.OK) return { error: betRes.code };
            //     }
            //     let isBonusGame = haveTreasure ? 1 : 0;
            //     let winRes = yield self.app.controllers.fishHunterPlayer.callWin(player, res, bullet, gain, bullet.cost, isBonusGame);
            //     if (winRes.code !== C.OK) return { error: winRes.code };
            //     break;
            //   case consts.walletType.singleBetAndWin:
            //     let cost = bullet.cost;
            //     // 鑽頭炮 & 雷射炮 & 機關炮 bet = 0;
            //     if (bullet.shootType == consts.FishType.DRILL || bullet.shootType == consts.FishType.LASER || bullet.shootType == consts.FishType.BAZOOKA) cost = 0;
            //     let betAndWinRes = yield self.app.controllers.fishHunterPlayer.callBetAndWin(player, res, bullet, gain, cost, false, []);
            //     if (betAndWinRes.code !== C.OK) return { error: betAndWinRes.code };
            //     break;
            // }

            const data = { // to子單用
                areaId: player.areaId,
                playerId: playerId,
                gain: gain,
                die: res.die,
                fishTypes: res.ftypes.join(''),
                gameId: gameId,
                tableId: tableId,
                gameServerId: player.gameServerId,
                bullet: bullet,
                treasure: res.treasure,
                typeBombs: res.typeBombs,
                bombTypeList: res.bombTypeList,
                extraChainOdds: res.extraChainOdds,
                state: res.state,
                currency: player.currency,
                odds: res.odds,
                fishRealType: res.fishRealType,
            };

            // 有獲得 bazooka 免費子彈時 才有原始免費子彈數
            if (typeof res['originalAlive'] != 'undefined') {
                data['originalAlive'] = res.originalAlive;
            }

            if (res.ftypes.join('') === "")
                this.app.controllers.debug.info('error', '_onColliderAsync', {
                    player: player,
                    res: res
                });

            rsp.push(data);

            highOddsData.push(_.cloneDeep(res));

            // 刪除前端用不到的data
            delete res.totalBonus;
            delete res.hitresult;
            delete res.odds;
            delete res.success;
            delete res.ftypes;
            delete res.bombTypeList;
            delete res.avgOdds;
            delete res.randomConfig;
            delete res.fishTemp;
            delete res.extraBonusOdds;
            delete res.rcCheck;
            delete res.chairId;
            delete res.originalAlive;
            if (!haveTreasure) {
                delete res.treasure;
            } // 沒有寶藏刪除treasure key

            colliderData.push(res); // to碰撞結果用
        }

        const ret = {player: {id: playerId}, result: colliderData};
        // let data = { player: { id: playerId, gold: 0, delta: gain }, result: colliderData };
        self.app.controllers.table.pushAsync(tableId, null, consts.route.client.game.COLLIDER_RESULT, ret, false);

        self.app.controllers.broadcast.checkBroadcast(consts.BroadcastType.HIGH_ODDS, player, highOddsData); // 廣播高賠率訊息

        return {error: null, data: rsp};
    } catch (err) {
        logger.error('[colliderService][_onColliderAsync] result: %s, err: ', JSON.stringify(result), err);
        throw err;
    }
});
