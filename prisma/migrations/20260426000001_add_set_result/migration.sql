CREATE TABLE "SetResult" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "pointsA" INTEGER NOT NULL,
    "pointsB" INTEGER NOT NULL,
    "winnerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetResult_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SetResult" ADD CONSTRAINT "SetResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE