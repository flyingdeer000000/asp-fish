module.exports = {
    SUCCESS: '0000',
    FAILED: '9999',
    PLAYER_IS_LOCK: '9001',
    BAD_ENCRYPT: '9004',
    DATA_EXPIRE: '9005',
    UNKNOW_ACTION: '9007',
    UNKNOW_PLATFORM: '9008',

    // authenticate
    AUTH_IP_BLACK_LIST: '9101', // 遊玩 IP 已被列為黑名單
    AUTH_GAME_TOKEN_EXPIRED: '9102', // 遊戲商 Token 過期
    AUTH_GAME_TOKEN_AGENTID_MISMATCH: '9103', // Token 與 API 夾帶的 agentId 不合
    AUTH_HALL_NOT_OPEN_GAME: '9104', // Hall 沒有開放該遊戲
    AUTH_HALL_NOT_FOUND_RTP: '9105', // 取不到 Hall 設定的 rtp
    AUTH_OP_TOKEN_EXPIRED: '9106', // 平台方 Token 過期
    AUTH_PLAYER_CURRENCY_MISMATCH: '9107', // 取得玩家資料時，幣別與當初創建時不同
    AUTH_PLAYER_NAME_LENGTH_INVALID: '9108', // 創建玩家帳號時，帳號長度不合法
    AUTH_AGENT_NOT_FOUND_CURRENCY: '9109', // Agent 沒有開放此幣別
    AUTH_NOT_IN_OPEN_AREA: '9110', // 玩家所在地區未在該幣別對應的開放地區列表中
    AUTH_NO_BET_SETTING: '9111', // 找不到該遊戲的投注設定
    AUTH_CREDIT_NOT_ENOUGH: '9112', // 信用額度不足
    AUTH_MAX_PLAYER_COUNT: '9113', // 人數已達上限
    AUTH_UP_LINE_IS_STOPPED: '9114', // 上線被停用


    // common
    PREDICTABLE_ERROR: '9500', // 可預期錯誤
    CUSTOMER_IN_MAINTENANCE_MODE: '9501', // 介接方維護中


    USER_NOT_EXIST: '7501', //User ID cannot be found
    INVALID_PASSWORD: '7604',
    TRADE_NO_REPEAT: '6005',
    INVALID_GAME: '6006',
    TRADE_ERROR: '7001',
    TRADE_COMPLETE_ERROR: '7002',
    EXCHANGE_ERROR: '7003',
    EXCHANGE_IGNORE: '7004',
    OUT_BALANCE: '7005',

    WHITELABEL_AUTH_FAIL: '2001', //驗證失敗

    // gsBridge:
    PLAYER_OUT_GOLD: '2004', // mysql 修改額度失敗 // modifyCustomerCreditAsync
}
