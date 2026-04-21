export enum MsgType {
  JOIN_ROOM = 0,
  STROKE    = 6,  // complete stroke: [6, color, width, [[x,y],[x,y],...], playerId]
  SYNC      = 9
}
