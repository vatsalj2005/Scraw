export enum MsgType {
  JOIN_ROOM  = 0,
  DRAW_START = 3,
  DRAW_MOVE  = 4,
  DRAW_END   = 5,
  STROKE     = 6,  // complete stroke: [6, color, width, [[x,y],[x,y],...], playerId]
  SYNC       = 9
}
