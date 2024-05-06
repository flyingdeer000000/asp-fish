

const codes = {
	// 状态码(code)
	OK:    200,                                                   // 操作成功
	FAILD: 201,                                                   // 操作失败
	SYSTEM_MAINTENANCE: 202,                                      // 系統維護
	ERROR: 500,                                                   // 操作不合法

	// 错误码(msg)
	GATE_NO_CONNECTOR:                      101,                  // 无连接服务
	ILLEGAL:                                102,                  // 参数非法
	REQUEST_TOO_SOON:                       103,                  // 請求太頻繁

	// API相關
	API_AUTH_TIME_OUT:                   	300,                  // API驗證超時
	API_AUTHING:                            301,                  // API驗證中
	API_AUTH_FAIL:                          302,                  // API驗證失敗

	// API - authenticate
	API_AUTH_IP_BLACK_LIST:                 303,                  // 遊玩 IP 已被列為黑名單
	API_AUTH_GAME_TOKEN_EXPIRED:            304,                  // 遊戲商 Token 過期
	API_AUTH_GAME_TOKEN_AGENTID_MISMATCH:   305,                  // Token 與 API 夾帶的 agentId 不合
	API_AUTH_HALL_NOT_OPEN_GAME:            306,                  // Hall 沒有開放該遊戲
	API_AUTH_HALL_NOT_FOUND_RTP:            307,                  // 取不到 Hall 設定的 rtp
	API_AUTH_OP_TOKEN_EXPIRED:              308,                  // 平台方 Token 過期
	API_AUTH_PLAYER_CURRENCY_MISMATCH:      309,                  // 取得玩家資料時，幣別與當初創建時不同
	API_AUTH_PLAYER_NAME_LENGTH_INVALID:    310,                  // 創建玩家帳號時，帳號長度不合法
	API_AUTH_AGENT_NOT_FOUND_CURRENCY:      311,                  // Agent 沒有開放此幣別
	API_AUTH_NOT_IN_OPEN_AREA:              312,                  // 玩家所在地區未在該幣別對應的開放地區列表中
	API_AUTH_NO_BET_SETTING:                313,                  // 找不到該遊戲的投注設定
	INSUFFICIENT_CREDIT_LIMIT:              314,                  // 信用額度不足 （toClient)
	SETTLEMENT_STILL_ON_GOING:              315,                  // 上一場結帳中... Settlement still on-going
	API_AUTH_MAX_PLAYER_COUNT:				316,				  // 人數已達上限

	API_RETURN_TOKEN_EXPIRED:				'9019',				  // API回傳 token 過期
	CUSTOMER_IN_MAINTENANCE_MODE:			'9501',				  // API回傳 介接方維護中
	CREDIT_QUOTA_NOT_ENOUGH:				'7069',				  // API回傳 信用額度不足

	// webConnector
	WEBCONNECTOR_AUTHING:                   351,                  // WwbConnector驗證中
	WEBCONNECTOR_AUTH_FAIL:                 352,                  // WwbConnector驗證中驗證失敗

	// 玩家相關
	PLAYER_NOT_LOGIN:                       203,                  // 玩家未登录
	PLAYER_NOT_FOUND:                       204,                  // 玩家不存在
	PLAYER_NOT_READY:                       205,                  // 有玩家没有准备
	PLAYER_NOT_FREE:                        208,                  // 玩家不在空闲状态
	PLAYER_NOT_PLAYING:                     210,                  // 玩家不在游戏状态

	PLAYER_IDLE_TOO_LONG_IN_LOBBY:			211,				  // 玩家閒置過久(大廳)
	PLAYER_IDLE_TOO_LONG_IN_ROOM:			212,                  // 玩家閒置過久(遊戲房)



	PLAYER_OUT_GOLD:                        216,                  // 余额不足
	PLAYER_WALLET_NOT_EXIST_OR_MULTIPLE:    221,                  // 玩家tokens不存在或mongo有兩個以上相同的錢包(gameId&playerId)
	PLAYER_STATE_SUSPEND:                   222,                  // 玩家帳號被 停用
	PLAYER_STATE_FREEZE:                    223,                  // 玩家帳號被 凍結
	PLAYER_STATE_NOT_SUSPEND_EVENT:			224,				  // 玩家狀態不支援該事件
	PLAYER_AREA_NOT_EXIST:                  225,                  // 玩家Area不存在
	PLAYER_WEAPON_NOT_EXIST:                226,                  // 特殊武器不存在
	PLAYER_BULLETID_NOT_EXIST:              227,                  // 玩家子彈ID不存在
	PLAYER_WEAPON_NOT_ENOUGH:				228,				  // 特殊武器不足
	PLAYER_IS_SINGLE_WALLET:                229,                  // 玩家是單錢包
	PLAYER_CANCEL_BULLETID_NOT_EXIST:       230,                  // 玩家取消的子彈ID不存在


	// 桌子相關
	TABLE_NOT_FOUND:                        501,                  // 桌子未找到
	TABLE_HAS_ALREADY:                      502,                  // 已经在桌子上
	TABLE_INSUFFICIENT_LIMIT:				503,				  // 桌子限額不足

	// 捕漁機相關
	FISH_PLAYER_MAX_BULLETS:                1001,                 // 捕漁機：最大子弹数
	FISH_PLAYER_BULLETID_DUPLICATE:         1002,                 // 捕漁機：玩家子彈ID重複
	FISH_COLLIDER_NO_VOUCHER:               1003,                 // 捕漁機：碰撞時找不到扣款憑證
	FISH_AREA_HAS_COMPLETED:                1004,                 // 捕漁機：漁場已经結束

	// 棋牌相關
	// ...

	// 老虎機相關
	// ...

	// 街機相關
	// ...
}

const reflect = {};

for(let key in codes) {
	reflect[key] = codes[key];
}

codes.REFLECT = reflect;

module.exports = codes;
