'use strict';
let quick = require('quick-pomelo');
let P = quick.Promise;
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('connector', __filename);
let utils = require('../utils/utils');
let util = require('util');
const apiCode = require('../expressRouter/apiServerStatus');

let Controller = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;

proto.addWagers = async function (player, areaPlayerHistory) {
    let self = this;

    try {
        let paramDefinConfig = self.app.controllers.fishHunterConfig.getParamDefinConfig(); // 取得參數設定檔
        let ggId = paramDefinConfig.game_ggid;

        //MySQL後台 v.s. 魚機母單 欄位對應
        let map = {
            'Cid': 'playerId',
            'Wid': '_id',
            'GameId': 'gameId',
            'IP': 'loginIp',
            'NewQuota': 'afterBalance',
            'OldQuota': 'beforeBalance',
            'Currency': 'currency',
            'BetPoint': 'cost',
            'WinPoint': 'gain',
            'ExCurrency': 'currency',
            'roundID': 'roundID',
            'IsSingleWallet': 'isSingleWallet',
            'GameTypeId': 'gameTypeId'
        }
        let obj = {};
        for (let x in map) {
            obj[x] = areaPlayerHistory[map[x]];
        }
        let denom = areaPlayerHistory['denom'];

        // 餘額
        obj['OldQuota'] = utils.number.workMultiply(obj['OldQuota'], denom);                                                // 舊餘額，單位：錢
        obj['NewQuota'] = utils.number.workMultiply(obj['NewQuota'], denom);                                                // 新餘額，單位：錢
        // 押注
        obj['BetPoint'] = utils.number.oneThousand(obj['BetPoint'], consts.Math.MULTIPLY);                                  // 遊戲押注(單位：分)
        obj['BetGold'] = utils.number.multiply(obj['BetPoint'], denom);  // 遊戲押注(單位：錢)
        obj['RealBetPoint'] = obj['BetPoint'];                                                                              // 有效押注(單位：分)   // TODO: 若魚機有JP後需調整這邊
        obj['RealBetGold'] = obj['BetGold'];                                                                                // 有效押注(單位：錢)   // TODO: 若魚機有JP後需調整這邊
        // 派彩
        obj['WinPoint'] = utils.number.oneThousand(obj['WinPoint'], consts.Math.MULTIPLY);                                  // 遊戲派彩(單位：分)
        obj['WinGold'] = utils.number.multiply(obj['WinPoint'], denom);   // 遊戲派彩(單位：錢)

        obj['GGId'] = ggId || 0;                                                                                            // 遊戲種類
        obj['CryDef'] = 1.000000;                                                                                           // TODO: 非JP的遊戲注單匯率都是1，若魚機有JP後需調整這邊
        obj['IsBonusGame'] = areaPlayerHistory['isBonusGame'];
        obj['ClientType'] = areaPlayerHistory['clientType'] == 'web' ? 0 : 1;
        obj['AddDate'] = utils.timeConvert(Date.now());//AddDate改使用離場當下的時間

        obj['UserName'] = player.userName;
        obj['UpId'] = player.upid;
        obj['HallId'] = player.hallId;
        obj['IsDemo'] = player.demo;

        //等待API Server回傳結果驗證
        let config = this.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;

        let opts = {
            method: consts.GSBridgeMethod.addWagers,
            platform: consts.APIServerPlatform.gsBridge,
            id: player._id,
            data: obj
        };

        logger.info('[wagers][addWagers][CallAPI] addWagers, opts = ', opts);
        let apiData = await utils.httpPost(url, opts);
        if (!!apiData && apiData.status == apiCode.SUCCESS) {
            logger.info('[wagers][addWagers][RES] addWagers SUCCESS, apiData = ', JSON.stringify(apiData));
        } else {
            logger.error('[wagers][addWagers][RES] addWagers FAIL, apiData: %s, opts: %s', JSON.stringify(apiData), opts);
        }
        // return apiData.data.playerInfo;
        return;
    } catch (err) {
        logger.error('[wagers][addWagers] err: %s, data: %s ', util.inspect(err, false, 10), util.inspect({
            playerId: player._id,
            areaPlayerHistory
        }, false, 10));
        return;
    }
}

proto.getWagerData = async function (player, wagersData) {
    let self = this;
    try {
        let paramDefinConfig = self.app.controllers.fishHunterConfig.getParamDefinConfig(); // 取得參數設定檔
        let ggId = paramDefinConfig.game_ggid;

        let {denom, bet, gain, wagerId, amount} = wagersData;
        let newQuota = utils.number.add(utils.number.sub(amount, bet), gain);
        let betGold = utils.number.oneThousand(utils.number.multiply(bet, denom), consts.Math.MULTIPLY);
        let winGold = utils.number.oneThousand(utils.number.multiply(gain, denom), consts.Math.MULTIPLY);

        let data = {
            Wid: wagerId, //[wagerId, idx].join('_'), // oldWId for HB
            Cid: player._id,
            GameId: player.gameId,
            NewQuota: utils.number.multiply(newQuota, denom),
            OldQuota: utils.number.multiply(amount, denom),
            roundID: player.roundID,
            IsSingleWallet: player.isSingleWallet === 0 ? 0 : 1,
            IsBonusGame: wagersData.isBonusGame,
            GameTypeId: wagersData.gameTypeId,
            Currency: player.currency,
            ExCurrency: player.currency,
            CryDef: denom,
            ClientType: player.clientType == 'web' ? 0 : 1,
            GGId: ggId || 0,
            IP: player.loginIp,
            AddDate: utils.timeConvert(Date.now()),
            UserName: player.userName,
            UpId: player.upid,
            HallId: player.hallId,
            IsDemo: player.demo,
        };

        // 同值欄位
        let betGoleField = ['BetGold', 'BetPoint', 'RealBetPoint', 'RealBetGold'];
        let winGoldField = ['WinGold', 'WinPoint'];
        for (let field of betGoleField) {
            data[field] = betGold;
        }
        for (let field of winGoldField) {
            data[field] = winGold;
        }

        return data;
    } catch (err) {
        logger.error('[wagers][getWagerData] err: %s, data: %s ', util.inspect(err, false, 10), util.inspect({areaPlayerHistory}, false, 10));
        return null;
    }
}