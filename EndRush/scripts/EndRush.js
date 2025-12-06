import { world, system, GameMode, CustomCommandParamType, CustomCommandStatus, CommandPermissionLevel } from "@minecraft/server";

const defLimit = 18000;
const endBonus = 4800;

const box = {
  time: 0,
  max: defLimit,
  on: false,
  totalTimeText: "",
};
const saveLoc = new Map();
const saveGameMode = new Map();
const activePlayers = new Set();
const reachedEnd = new Set();
let loopId = null;

function getTimeText(currentTick, maxTick) {
  const secondsLeft = Math.max(0, Math.floor((maxTick - currentTick) / 20));
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;

  const mm = minutes < 10 ? `0${minutes}` : minutes;
  const ss = seconds < 10 ? `0${seconds}` : seconds;

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

function playSound(soundId) {
  for (const player of activePlayers) {
    if (player && player.isValid) player.playSound(soundId);
  }
}

function cachePlayerData(player) {
  if (!player || !player.isValid) return;

  if (!saveLoc.has(player.id)) {
    saveLoc.set(player.id, {
      x: player.location.x,
      y: player.location.y,
      z: player.location.z,
      dim: player.dimension,
    });
  }

  if (!saveGameMode.has(player.id)) {
    try {
      saveGameMode.set(player.id, player.gameMode ?? GameMode.Survival);
    } catch {
      saveGameMode.set(player.id, GameMode.Survival);
    }
  }
}

function syncOnlinePlayers() {
  for (const p of world.getAllPlayers()) {
    if (!activePlayers.has(p)) {
      activePlayers.add(p);
      cachePlayerData(p);
    }
  }
}

function onPlayerJoin(player) {
  if (!player || !player.isValid) return;
  activePlayers.add(player);
  cachePlayerData(player);

  if (box.on) {
    player.setGameMode(GameMode.Survival);
    const currentTime = getTimeText(box.time, box.max);
    player.onScreenDisplay.setActionBar(`§c${currentTime} §7/ ${box.totalTimeText}`);
  }
}

function removeActiveById(playerId) {
  try {
    for (const player of activePlayers) {
      if (player.id === playerId) {
        activePlayers.delete(player);
        break;
      }
    }
  } catch (e) {
    console.warn(e);
  }
}

function fail() {
  try {
    box.on = false;
    world.sendMessage("§c[!] หมดเวลาแล้ว! §gเกมจบลง");
    playSound("mob.wither.death");

    for (const player of activePlayers) {
      if (player && player.isValid) player.setGameMode(GameMode.Spectator);
    }

    box.time = 0;
    box.max = defLimit;
    box.totalTimeText = "";

    if (loopId) {
      system.clearRun(loopId);
      loopId = null;
    }
  } catch (e) {
    console.warn("fail: " + e);
  }
}

function stopRun() {
  try {
    box.on = false;

    for (const player of activePlayers) {
      if (!player || !player.isValid) continue;

      if (saveLoc.has(player.id)) {
        const home = saveLoc.get(player.id);
        player.teleport(home, { dimension: home.dim });
        player.sendMessage?.("§e[<<] เทเลพอร์ตกลับมา");
      }
      player.getComponent("inventory")?.container?.clearAll();
      player.setGameMode(saveGameMode.get(player.id) ?? GameMode.Survival);
    }

    saveGameMode.clear();
    saveLoc.clear();
    activePlayers.clear();
    reachedEnd.clear();
    playSound("note.bass");

    box.time = 0;
    box.max = defLimit;
    box.totalTimeText = "";

    if (loopId) {
      system.clearRun(loopId);
      loopId = null;
    }
  } catch (e) {
    console.warn("stop: " + e);
  }
}

function startRun(origin, duration) {
  try {
    if (box.on) {
      origin?.sendMessage?.("§e[!] การนับเวลาได้ดำเนินการอยู่");
      return;
    }

    if (typeof duration === "number" && duration > 0 && duration < 1440) {
      box.max = Math.floor(duration * 60) * 20;
    } else {
      box.max = defLimit;
    }

    box.time = 0;
    box.on = true;

    box.totalTimeText = getTimeText(0, box.max);

    syncOnlinePlayers();
    for (const player of activePlayers) {
      if (player && player.isValid) player.setGameMode(GameMode.Survival);
    }

    world.sendMessage(`§a[>>] เริ่มสปีดรันแล้ว! §7เป้าหมาย: ${box.totalTimeText}`);
    playSound("random.orb");

    if (!loopId) {
      loopId = system.runInterval(gameTick, 1);
    }
  } catch (e) {
    console.warn("start: " + e);
  }
}

function gameTick() {
  try {
    if (!box.on) return;

    const currentTime = getTimeText(box.time, box.max);
    const actionBarMsg = `§c${currentTime} §7/ ${box.totalTimeText}`;

    for (const player of activePlayers) {
      if (player && player.isValid) {
        player.onScreenDisplay.setActionBar(actionBarMsg);
      }
    }

    if (box.time >= box.max) {
      fail();
      return;
    }

    box.time++;

    if (box.max - box.time <= 200 && box.time % 20 === 0) {
      playSound("note.pling");
    }
  } catch (e) {
    console.warn("tick: " + e);
  }
}

system.beforeEvents.startup.subscribe((ev) => {
  try {
    ev.customCommandRegistry.registerEnum("addon:Option", ["start", "reset"]);

    ev.customCommandRegistry.registerCommand(
      {
        name: "addon:run",
        description: "Speedrun Timer Control",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        mandatoryParameters: [{ name: "mode", type: CustomCommandParamType.Enum, enumName: "addon:Option" }],
        optionalParameters: [{ name: "time", type: CustomCommandParamType.Float }],
      },
      (origin, mode, time) => {
        system.run(() => {
          if (mode === "start") startRun(origin.sourceEntity, time);
          if (mode === "reset") stopRun();
        });
        return { status: CustomCommandStatus.Success };
      }
    );
  } catch (e) {
    console.warn("cmd setup: " + e);
  }
});

world.afterEvents.playerJoin.subscribe((ev) => {
  onPlayerJoin(ev.playerId);
});

world.afterEvents.playerLeave.subscribe((ev) => {
  removeActiveById(ev.playerId);
});

world.afterEvents.playerDimensionChange.subscribe((ev) => {
  try {
    if (!box.on || !ev.player || !ev.player.isValid) return;

    if (ev.toDimension.id === "minecraft:the_end" && !reachedEnd.has(ev.player.id)) {
      reachedEnd.add(ev.player.id);
      box.max += endBonus;

      box.totalTimeText = getTimeText(0, box.max);

      world.sendMessage(`§d[+] เข้าถึงมิติ The End แล้ว! เพิ่มโบนัสเวลา ${getTimeText(0, endBonus)}`);
      playSound("random.levelup");
    }
  } catch (e) {
    console.warn("end bonus: " + e);
  }
});
