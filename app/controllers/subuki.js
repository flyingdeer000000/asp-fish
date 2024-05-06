'use strict';

let _ = require('lodash');
let quick = require('quick-pomelo');
let logger = quick.logger.getLogger('connector', __filename);
let consts = require('../../share/consts');
let utils = require('../utils/utils');

let Controller = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;

// 風控檢查(RTP上限)
proto.checkSUBUKI_MaxRTP = function (unSubuki, die, player, randomConfig, check, score, bulletCost, debugData) {
    try {
        let self = this;
        let killFirst = debugData.killFirst;
        // let noDieFirst = debugData.noDieFirst;

        let RCconfig = this.app.controllers.fishHunterConfig.getRCServerConfig();
        let limitConfig = RCconfig.rcServers.limit[player.gameId];
        if (!limitConfig) {
            //未設定則使用共用
            logger.warn('[subuki][checkSUBUKI_MaxRTP] 遊戲 %s 未設定rcServers.limit，取common設定使用 !!!', player.gameId);
            limitConfig = RCconfig.rcServers.limit["common"];
        }
        if (!limitConfig) {
            logger.error('[subuki][checkSUBUKI_MaxRTP] 遊戲 %s 未設定rcServers.limit.common !!!', player.gameId);
            // logger.fatal('[subuki][checkSUBUKI_MaxRTP] 遊戲 %s 未設定rcServers.limit.common !!!', player.gameId);
            return {randomConfig: randomConfig, die: false};
        }

        limitConfig = limitConfig['global'];
        let rcCheck = {check, limitConfig};
        logger.info('[subuki][checkSUBUKI_MaxRTP] 遊戲 %s, playerId: %s, die: %s, unSubuki: %s, debugData: %s, isPromo: %s, bulletCost: %s, exchangeRate: %s, rcCheck: ', player.gameId, player._id, die, unSubuki, JSON.stringify(debugData), player.isPromo, bulletCost, player.exchangeRate, rcCheck);

        // 本來就沒捕獲，提早跳出
        if (!die || player.isPromo) {
            // 推廣模式，提早跳出
            return {randomConfig: randomConfig, die: die, rcCheck};
        }

        // SUBUKI機制 - 超過rtp臨界值RTPLimit時，若獲得倍數超過臨界倍數OddsLimit一律判定為捕獲失敗
        if (!unSubuki && !killFirst) {
            if (!!check) {
                bulletCost = utils.number.divide(bulletCost, player.exchangeRate); // 換算成 CNY
                let rtpCheck = utils.number.workDivide(utils.number.add(check.totalGain, utils.number.multiply(score, bulletCost)), utils.number.add(check.totalCost, bulletCost));
                logger.info('[subuki][checkSUBUKI_MaxRTP] gameId: %s, playerId: %s, bulletCost: %s, rtpCheck: ', player.gameId, player._id, bulletCost, rtpCheck);
                let count = limitConfig.length;
                for (let i = 0; i < count; i++) {
                    if ((rtpCheck > limitConfig[i].rtpLimit) && (score > limitConfig[i].oddsLimit)) {
                        //超出風控 吃掉
                        logger.warn('[subuki][checkSUBUKI_MaxRTP] 遊戲%s 目前rtp:%s 超過第%s階RTP上限:%s，打中賠率%sx 但吃掉結果 !!!', player.gameId, rtpCheck, i + 1, limitConfig[i].rtpLimit, score);
                        return {randomConfig: randomConfig, die: false, rcCheck};
                    }
                }
                //風控內 放行
                return {randomConfig: randomConfig, die: die, rcCheck};
            }
            //check不存在 不吃掉
            logger.warn('[subuki][checkSUBUKI_MaxRTP] 遊戲%s 風控check不存在，以正常機率處理，打中賠率%sx !!! die: %s', player.gameId, score, die);
            // logger.fatal('[subuki][checkSUBUKI_MaxRTP] 遊戲%s 風控check不存在，以正常機率處理，打中賠率%sx !!! die: %s' , player.gameId, score, die);
            return {randomConfig: randomConfig, die: die, rcCheck};
        } else {
            if (!utils.checkENV(self.app, 'development')) {
                // 測試不發報
                logger.warn('[subuki][checkSUBUKI_MaxRTP] 遊戲%s 風控未檢查，打中賠率%sx!!!', player.gameId, score);
                // logger.fatal('[subuki][checkSUBUKI_MaxRTP] 遊戲%s 風控未檢查，打中賠率%sx!!!', player.gameId, score);
            }
            return {randomConfig: randomConfig, die: die, rcCheck};
        }
    } catch (err) {
        logger.error('[subuki][checkSUBUKI_MaxRTP] err : ', err);
        // logger.fatal('[subuki][checkSUBUKI_MaxRTP] err : ', err);
        return {randomConfig: randomConfig, die: false};
    }
}

// 風控檢查(幣別贏分上限)
proto.checkSUBUKI_MaxReward = async function (res, player, area, fishScore, treasureList, betSetting, areaConfig) {
    try {
        if (res.die) {
            if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
                logger.error(`[subuki][checkSUBUKI_MaxReward] no betSetting! playerId: ${player._id}`);
                res.die = false;
                return res;
            }
            // let currencyConfig = this.app.controllers.fishHunterConfig.getCurrencyConfigByDC(player.dc);
            // if (!currencyConfig)    currencyConfig = this.app.controllers.fishHunterConfig.getCurrencyConfig();
            // let maxReward = currencyConfig[(player.currency?player.currency:'CNY')].maxReward;
            let maxReward = betSetting.maxReward;
            let totalOdds = utils.number.multiply(res.totalBonus, res.extraChainOdds);
            let tempReward = utils.number.multiply(totalOdds, res.cost);
            let originalData = {reward: tempReward, totalBonus: res.totalBonus, extraChainOdds: res.extraChainOdds};
            let i = 0;
            let rewardList = [];
            // SUBUKI機制 - 單把贏分超過最大幣別贏分臨界值maxReward時，重複判定十次，若期間未小於則一律判定為捕獲失敗
            if (fishScore[res.fishRealType].vals.length > 1) {
                //有其他贏分結果（隨機倍率)
                while ((tempReward > maxReward || (totalOdds > consts.MAX_ODDS && consts.MAX_ODDS > 0)) && i < 10) {
                    i++;
                    //重置魚種倍數
                    res = this.app.controllers.colliderService.getFishResetInfo(res);
                    res = await this.app.controllers.colliderService.getHitFishDataInfo(res.fishTemp, treasureList, areaConfig, fishScore, area, res, player);
                    //重算單把贏分
                    totalOdds = utils.number.multiply(res.totalBonus, res.extraChainOdds);
                    tempReward = utils.number.multiply(totalOdds, res.cost);
                    rewardList.push(tempReward);
                }

                if (i >= 10) {
                    res.die = false;
                    logger.warn('[subuki][checkSUBUKI_MaxReward] 重RAN後超過幣別贏分或限定倍數上限，吃掉結果 !!! : player: %s, res: ', JSON.stringify(player), res);
                    // logger.error('[subuki][checkSUBUKI_MaxReward] 重RAN後超過幣別贏分或限定倍數上限，吃掉結果 !!! : player: %s, res: ', JSON.stringify(player), res);
                    // logger.fatal('[subuki][checkSUBUKI_MaxReward] 重RAN後超過幣別贏分或限定倍數上限，吃掉結果 !!! : player: %s, res: ', JSON.stringify(player), res);
                } else if (i > 1) {
                    logger.warn('[subuki][checkSUBUKI_MaxReward] 重RAN後低於幣別贏分或限定倍數上限，替換結果 !!! : player: %s, res: %s, originalData: %s, rewardList: ', JSON.stringify(player), JSON.stringify(res), JSON.stringify(originalData), rewardList);
                    // logger.error('[subuki][checkSUBUKI_MaxReward] 重RAN後低於幣別贏分或限定倍數上限，替換結果 !!! : player: %s, res: %s, originalData: %s, rewardList: ', JSON.stringify(player), JSON.stringify(res), JSON.stringify(originalData), rewardList);
                    // logger.fatal('[subuki][checkSUBUKI_MaxReward] 重RAN後低於幣別贏分或限定倍數上限，替換結果 !!! : player: %s, res: %s, originalData: %s, rewardList: ', JSON.stringify(player), JSON.stringify(res), JSON.stringify(originalData), rewardList);
                }
            } else {
                //沒有其他贏分結果，判定為捕獲失敗
                if (tempReward > maxReward || tempReward > consts.MAX_ODDS) {
                    logger.warn('[subuki][checkSUBUKI_MaxReward] 非隨機賠率超過幣別贏分或限定倍數上限，吃掉結果 !!! : player: %s, res: ', JSON.stringify(player), res);
                    // logger.error('[subuki][checkSUBUKI_MaxReward] 非隨機賠率超過幣別贏分或限定倍數上限，吃掉結果 !!! : player: %s, res: ', JSON.stringify(player), res);
                    // logger.fatal('[subuki][checkSUBUKI_MaxReward] 非隨機賠率超過幣別贏分或限定倍數上限，吃掉結果 !!! : player: %s, res: ', JSON.stringify(player), res);
                    res.die = false;
                }
            }
        }
        return res;
    } catch (err) {
        logger.error('[subuki][checkSUBUKI_MaxReward] err : ', err);
        // logger.fatal('[subuki][checkSUBUKI_MaxReward] err : ', err);
        res.die = false;
        return res;
    }
}

// 風控檢查(未捕獲觸發或額外觸發)
proto.checkSUBUKI_ExtraTrigger = function (res, gameId) {
    try {
        if (!res.rcCheck || !res.rcCheck.check) {
            logger.warn('[subuki][checkSUBUKI_ExtraTrigger] res.rcCheck =  undefined');
            // logger.fatal('[subuki][checkSUBUKI_ExtraTrigger] res.rcCheck =  undefined');
            // TODO dev remove
            // return false;
            return true;
        }

        let rtpCheck = utils.number.workDivide(res.rcCheck.check.totalGain, res.rcCheck.check.totalCost);

        let limitConfig = res.rcCheck.limitConfig;
        let count = limitConfig.length;
        for (let i = 0; i < count; i++) {
            if (rtpCheck > limitConfig[i].rtpLimit) {
                //超出風控 吃掉
                logger.warn('[subuki][checkSUBUKI_ExtraTrigger] 遊戲%s 目前rtp:%s 超過第%s階RTP上限:%s，不再觸發NoDieBonus和ExtraBonus !!!', gameId, rtpCheck, i + 1, limitConfig[i].rtpLimit);
                // logger.fatal('[subuki][checkSUBUKI_ExtraTrigger] 遊戲%s 目前rtp:%s 超過第%s階RTP上限:%s，不再觸發NoDieBonus和ExtraBonus !!!', gameId, rtpCheck, i + 1, limitConfig[i].rtpLimit);
                return false;
            }
        }
        return true;
    } catch (err) {
        logger.error('[subuki][checkSUBUKI_ExtraTrigger] err : ', err);
        // logger.fatal('[subuki][checkSUBUKI_ExtraTrigger] err : ', err);
        return false;
    }
}

// 風控檢查(推廣帳號打不死BAZOOKA)
proto.checkSUBUKI_PromoBAZOOKA = function (res, player) {
    try {
        if (res.die && !!player
            && player.isPromo
            && res.fishTemp
            && res.fishTemp.type === consts.FishType.BAZOOKA
        ) {
            res.die = false;
            return res;
        }
        return res;
    } catch (err) {
        logger.error('[subuki][checkSUBUKI_PromoBAZOOKA] err : ', err);
        // logger.fatal('[subuki][checkSUBUKI_PromoBAZOOKA] err : ', err);
        return false;
    }
}

// 風控檢查(後扣型打不死免費子彈類)，因使用後扣型單錢包有可能導致獲得武器未扣款成功，但免費子彈已獲得派彩的問題，故都先擋掉打不死
proto.checkSUBUKI_FreeGame = function (res, player) {
    try {
        const specialGames = ["10004", "10005", "10006"];
        const fishTypeMatch = (res.fishTemp.type === consts.FishType.BAZOOKA                                // 機關炮
            || res.fishTemp.type === consts.FishType.DRILL                               // 鑽頭砲
            || res.fishTemp.type === consts.FishType.LASER                               // 電磁砲
            || res.fishTemp.type === consts.FishType.BOMB_CRAB                           // 炸彈蟹
            || res.fishTemp.type === consts.FishType.SERIAL_BOMB_CRAB                    // 連環炸彈蟹
        );
        if (res.die
            && !!player
            && specialGames.indexOf(player.gameId) > -1                                     // HB遊戲
            // && player.isSingleWallet == consts.walletType.singleBetAndWinDelay           // 後扣型
            // && !player.mySQLWallet                                                       // 錢包在平台
            && !!res.fishTemp                                                               // 免費子彈類
            && fishTypeMatch
        ) {
            res.die = false;
            return res;
        }
        return res;
    } catch (err) {
        logger.error('[subuki][checkSUBUKI_FreeGame] err : ', err);
        // logger.fatal('[subuki][checkSUBUKI_FreeGame] err : ', err);
        return false;
    }
}
