'use strict';

let redisCacheCode = require('../../share/redis/redisCacheCode');
let redisSetting = require('./../../config/redisCache');
let redis = require('then-redis');
let logger = require('pomelo-logger').getLogger('redisCache', __filename);
let C = require('../../share/constant');
let utils = require('../utils/utils');

const DB_SELECT = {
    REQ_DEF: 1,
    BILL_BUFFERS_DB: 11,
};

// const REQDEF = "reqDef:";
const BULLETDATAS = "bulletDatas";


let Controller = function (app) {
    this.app = app;

    //寫
    this.redisMaster = redis.createClient({
        host: redisSetting.master.host,
        port: redisSetting.master.port,
        database: redisSetting.master.db,
        no_ready_check: true             // https://www.cnblogs.com/hxdoit/p/8664946.html  修正Redis connection lost and command aborted
    });
    //讀
    this.redisSlave = redis.createClient({
        host: redisSetting.slave.host,
        port: redisSetting.slave.port,
        database: redisSetting.slave.db,
        no_ready_check: true             // https://www.cnblogs.com/hxdoit/p/8664946.html  修正Redis connection lost and command aborted
    });
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;

// proto.getRedisMaster = function () {
//     return this.redisMaster;
// }
// proto.getRedisSlave = function () {
//     return this.redisSlave;
// }

//取Key
// proto.getRedisCacheKey = function (table_name, uniqueKey) {
//     return [table_name, uniqueKey].join(':');
// }

//優先取REDIS的緩存，若無才取DB資料並寫入REDIS
// proto.getCacheOrDoActQuery = function (db_name, table_name, uniqueKey, sql, args, selectDB, ttl, cb) {
//     let key = this.getRedisCacheKey(table_name, uniqueKey);
//     this.redisSlave.select(selectDB);
//     this.redisSlave.get(key, function(err, res) {
//         if (err) logger.warn("[redisCache][getCacheOrDoActQuery] err : ", err);
//
//         //缓存存在
//         if (res)
//             // 直接回傳
//             cb(null, {code: code.OK}, JSON.parse(res));
//         else
//             //向DB執行Action並寫入REDIS
//             this.doActQueryAndSetCache(db_name, table_name, uniqueKey, sql, args, selectDB, ttl, cb);
//     })
// };

//更新資料有機會影響到REDIS緩存時，統一清掉緩存下次重取避免多台同時操作REDIS寫入時造成lock err
// proto.insertOrUpdateDataAndDelCache = function (db_name, table_name, uniqueKey, sql, args, selectDB, ttl, cb) {
//     //不管insert還是update都需清掉緩存
//     try {
//         let key = this.getRedisCacheKey(table_name, uniqueKey);
//         this.redisMaster.select(selectDB);
//         this.redisMaster.del(key);
//     } catch(e) {
//         logger.warn('[redisCache][insertOrUpdateDataAndDelCache], e: ', e)
//     }
//     //向DB執行Action並寫入REDIS
//     this.doActQueryAndSetCache(db_name, table_name, uniqueKey, sql, args, selectDB, ttl, cb);
// }

//取DB資料並寫入REDIS
// proto.doActQueryAndSetCache = function (db_name, table_name, uniqueKey, sql, args, selectDB, ttl, cb) {
//     let isSelect = (sql.toLowerCase().indexOf("select") >= 0 && sql.toUpperCase().indexOf("SELECT") >= 0);
//     db.act_query(db_name, sql, args, function (r_code, r_data) {
//         if (r_code.code !== code.OK) {
//             cb(null, r_code, null);
//         } else {
//             try {
//                 if (isSelect) {
//                     //寫到緩存
//                     this.redisMaster.select(selectDB);
//                     let key = this.getRedisCacheKey(table_name, r_data[0][redisCacheCode.TABLE_KEY[table_name]]);
//                     this.redisMaster.set(key, JSON.stringify(r_data[0]), 'EX', (ttl)?ttl:-1);
//                 }
//             } catch(e) {
//                 logger.warn('[redisCache][doActQueryAndSetCache], e: ', e)
//             }
//             if (r_data.length > 0)
//                 cb(null, r_code, r_data[0]);
//             else
//                 cb(null, r_code, r_data);
//         }
//     });
// };

// //防止惡意連續事件請求
// proto.checkRequestDef = async function (playerId, requestDefData) {
//     try {
//         let self = this;
//
//         //檢查Redis狀態未連線則視為不防禦
//         if (!self.isReady())    return {code: C.OK};
//
//         await self.redisSlave.select(DB_SELECT.REQ_DEF);
//
//         //檢查是否已被逞罰
//         let lockKey = REQDEF + requestDefData.lockKey + playerId;
//         let checkLock = await self.redisSlave.get(lockKey);
//         await self.redisSlave.select(DB_SELECT.REQ_DEF);
//         let ttl = await self.redisSlave.ttl(lockKey);
//         //事件請求太多次的逞罰
//         if (checkLock || ttl > 0)
//             return {code: C.REQUEST_TOO_SOON};
//
//         //計算請求次數
//         let redisKey = REQDEF + requestDefData.redisKey + playerId;
//         await self.redisSlave.select(DB_SELECT.REQ_DEF);
//         let checkTime = await self.redisSlave.get(redisKey);
//         await self.redisSlave.select(DB_SELECT.REQ_DEF);
//         ttl = await self.redisSlave.ttl(redisKey);
//         await self.redisMaster.select(DB_SELECT.REQ_DEF);
//         let requestTime = await self.redisMaster.incr(redisKey);
//         if (!checkTime || !ttl || ttl < 0) {
//             // 第一次或過期後要設定過期時間
//             await self.redisMaster.select(DB_SELECT.REQ_DEF);
//             await self.redisMaster.expire(redisKey, requestDefData.TTL);
//         } else if ( requestTime >= requestDefData.requestCount) {
//             //超過將記錄清掉，也避免高並發時第一次未設定到expire的問題
//             await self.redisMaster.select(DB_SELECT.REQ_DEF);
//             self.redisMaster.del(redisKey);
//
//             //設定逞罰紀錄
//             self.redisMaster.set(lockKey, 1);
//             await self.redisMaster.expire(lockKey, requestDefData.lockTime);
//             //事件請求太多次的逞罰
//             return {code: C.REQUEST_TOO_SOON};
//         }
//         return {code: C.OK};
//
//     } catch (err) {
//         logger.error('[redisCache][checkRequestDef] playerId: %s, err: ', playerId, err);
//     }
// };

// //清除惡意連續事件請求的紀錄()
// proto.clearRequestDef = async function (playerId, requestDefConf) {
//     try{
//         let self = this;
//
//         if (!playerId)
//             throw ('playerId = '+ playerId);
//         if (!requestDefConf)
//             throw ('requestDefConf = ' + requestDefConf);
//
//         let redisKey;
//         self.redisMaster.select(DB_SELECT.REQ_DEF);
//         Object.keys(requestDefConf).forEach((key) => {
//             //只清除請求紀錄redisKey不清除逞罰紀錄
//             redisKey = REQDEF + requestDefConf[key].redisKey + playerId;
//             self.redisMaster.del(redisKey);
//         });
//         logger.debug('[redisCache][clearRequestDef] done ');
//     } catch (err) {
//         logger.error('[redisCache][clearRequestDef] playerId: %s, err: ', playerId, err);
//     }
// }

// 檢查Redis狀態
proto.isReady = function () {
    try {
        let self = this;

        // 檢查
        let res = (self.redisMaster.ready && self.redisSlave.ready);
        if (!self.redisMaster.ready)
            logger.error('[redisCache][isReady] redisMaster(%s:%s) ready = %s，請儘速啟動！！！', self.redisMaster.host, self.redisMaster.port, self.redisMaster.ready);
        if (!self.redisSlave.ready)
            logger.error('[redisCache][isReady] redisSlave(%s:%s) ready = %s，請儘速啟動！！！', self.redisSlave.host, self.redisSlave.port, self.redisSlave.ready);
        return res
    } catch (err) {
        logger.error('[redisCache][isReady] err: ', err);
    }
}

// 新增一筆API尚未回傳或正在retry的子單id
proto.addSubIdFromAPIfail = async function (serverId, _id, sourceWid, wagerId) {
    try {
        let self = this;

        //檢查Redis狀態未連線則視為不防禦
        if (!self.isReady()) return null;

        await self.redisSlave.select(DB_SELECT.BILL_BUFFERS_DB);

        let redisKey = `${BULLETDATAS}:${serverId}:${sourceWid}`;
        await self.redisMaster.select(DB_SELECT.BILL_BUFFERS_DB);
        await self.redisMaster.hset(redisKey, _id, wagerId);
        return;
    } catch (err) {
        logger.error(`[redisCache][addSubIdFromAPIfail] playerId: ${wagerId.substr(0, 12)} sourceWid: ${sourceWid} _id: ${_id}, wId: ${wagerId}, serverId: ${serverId}, err: `, err);
        return null;
    }
};

// 取出API尚未回傳或正在retry的母單單號(wid)
proto.getWidsFromAPIfail = async function (serverId) {
    try {
        let self = this;
        //檢查Redis狀態未連線則視為不防禦
        if (!self.isReady()) return null;

        await self.redisSlave.select(DB_SELECT.BILL_BUFFERS_DB);
        let redisKey = `${BULLETDATAS}:${serverId}:`;
        // 取出所有需檢查有無扣款成功的 wid
        let getCheckedList = await self.redisSlave.keys(redisKey + '*');
        // getCheckedList = [ 'bulletDatas:fishHunter-server-1:sourceWid_1', 'bulletDatas:fishHunter-server-1:sourceWid_2' ]
        if (getCheckedList.length <= 0) return null;
        await self.redisMaster.select(DB_SELECT.BILL_BUFFERS_DB);
        let reData = {};
        for (let key of getCheckedList) {
            // 來源 wId
            let wId = key.split(':')[2]; // key.split(':') = ["bulletDatas", "fishHunter-server-1", "hoznE4RsufxaBqnYtuaayz100050722212039048"]
            // wIdTimeFormat = '2021-07-21 09:30:38.987';
            let wIdTimeFormat = `${new Date().getFullYear()}-${wId.substr(-13, 2)}-${wId.substr(-11, 2)} ${wId.substr(-9, 2)}:${wId.substr(-7, 2)}:${wId.substr(-5, 2)}.${wId.substr(-3, 3)}`;
            // 換算出母單 9000+3 秒的時間字串(到豪秒數) ex. 2021-07-21 09:30:38.987 的 orverTime = 2021-07-21 12:00:41.987 = 0717171902860
            let widOverTime = utils.getDateTime(Date.parse(wIdTimeFormat) + (9003 * 1000), 'milliSeconds');
            // 取現在時間字串(到豪秒數) ex.0721124159336
            let nowTime = utils.getDateTime(null, 'milliSeconds');
            // 取出母單超過 9000+3 秒
            if (nowTime > widOverTime) {
                let bulletList = await self.redisSlave.hkeys(redisKey + wId);
                if (!bulletList) {
                    logger.warn(`[redisCache][getWidsFromAPIfail] 不應該沒有子單列表. serverId: ${serverId}, redisKey: ${redisKey + wId}, bulletList:`, bulletList);
                    continue;
                }
                reData[wId] = bulletList;
            }
        }
        return reData;
    } catch (err) {
        logger.error(`[redisCache][getWidsFromAPIfail] serverId: ${serverId}, err: `, err);
        return null;
    }
};

// 刪除API已回傳 // 非 [API超時] [重試retry] 的
proto.delWidFromAPIfail = async function (serverId, sourceWid, subId) {
    try {
        let self = this;

        //檢查Redis狀態未連線則視為不防禦
        if (!self.isReady()) return null;
        await self.redisMaster.select(DB_SELECT.BILL_BUFFERS_DB);
        let redisKey = `${BULLETDATAS}:${serverId}:${sourceWid}`;
        if (subId) {
            // 刪除 redis 該 sourceWid 內的 subId
            await self.redisMaster.hdel(redisKey, subId);
        } else {
            // 刪除 redis 該 sourceWid
            await self.redisMaster.del(redisKey);
        }
        return;
    } catch (err) {
        logger.error(`[redisCache][delWidFromAPIfail] playerId: ${sourceWid.substr(0, 12)}, sourceWid: ${sourceWid}, serverId: ${serverId} err: `, err);
        return null;
    }
};