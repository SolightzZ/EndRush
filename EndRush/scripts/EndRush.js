import { world, system, GameMode, CustomCommandParamType, CustomCommandStatus, CommandPermissionLevel } from "@minecraft/server";

const CONFIG = {
  DEF_LIMIT: 18000,
  END_BONUS: 4800,
  MSG_HEADER: "§7------------------------",
};

const state = {
  time: 0,
  max: CONFIG.DEF_LIMIT,
  initialMax: CONFIG.DEF_LIMIT,
  isRunning: false,
  displayString: "",
  loopId: null,
};

const DB = {
  loc: new Map(),
  mode: new Map(),
  active: new Set(),
  reachedEnd: new Set(),
};

const Utils = {
  formatTime(current, max) {
    if (current > max) return "00:00";

    const diff = Math.max(0, max - current);
    const totalSeconds = Math.floor(diff / 20);

    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    const mm = m < 10 ? `0${m}` : m;
    const ss = s < 10 ? `0${s}` : s;

    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  },

  updateTimeState(newMax) {
    state.max = newMax;
    state.displayString = this.formatTime(0, state.max);
  },

  broadcastSound(soundId) {
    for (const player of DB.active) {
      if (player?.isValid) player.playSound(soundId);
    }
  },

  broadcastMsg(msg) {
    world.sendMessage(msg);
  },
};

const PlayerSys = {
  saveState(player) {
    if (!player?.isValid) return;

    if (!DB.loc.has(player.id)) {
      DB.loc.set(player.id, {
        x: player.location.x,
        y: player.location.y,
        z: player.location.z,
        dim: player.dimension,
      });
    }

    if (!DB.mode.has(player.id)) {
      DB.mode.set(player.id, player.gameMode ?? GameMode.Survival);
    }
  },

  restoreState(player) {
    if (!player?.isValid) return;

    const savedLoc = DB.loc.get(player.id);
    if (savedLoc?.dim) {
      player.teleport(savedLoc, { dimension: savedLoc.dim });

      player.sendMessage("§e[<<] เทเลพอร์ตกลับมา");
    }

    player.getComponent("inventory")?.container?.clearAll();
    player.setGameMode(DB.mode.get(player.id) ?? GameMode.Survival);
  },

  register(player) {
    if (!player?.isValid) return;

    DB.active.add(player);
    this.saveState(player);

    if (state.isRunning) {
      player.setGameMode(GameMode.Survival);
    }
  },

  unregister(playerId) {
    for (const player of DB.active) {
      if (player.id === playerId) {
        DB.active.delete(player);
        break;
      }
    }
  },

  syncAll() {
    for (const p of world.getAllPlayers()) {
      if (!DB.active.has(p)) {
        this.register(p);
      }
    }
  },
};

const Game = {
  start(origin, minutes) {
    if (state.isRunning) {
      origin?.sendMessage("§e[!] เกมกำลังดำเนินอยู่");
      return;
    }

    let calcMax = CONFIG.DEF_LIMIT;
    if (typeof minutes === "number" && minutes > 0 && minutes < 1440) {
      calcMax = Math.floor(minutes * 60) * 20;
    }

    state.initialMax = calcMax;
    Utils.updateTimeState(calcMax);
    state.time = 0;
    state.isRunning = true;

    PlayerSys.syncAll();
    for (const p of DB.active) {
      if (p.isValid) p.setGameMode(GameMode.Survival);
    }

    Utils.broadcastMsg(`§a[>>] เริ่มสปีดรันแล้ว! §7เป้าหมาย: ${state.displayString}`);
    Utils.broadcastSound("random.orb");

    if (!state.loopId) {
      state.loopId = system.runInterval(() => this.tick(), 20);
    }
  },

  stop() {
    state.isRunning = false;

    for (const p of DB.active) {
      PlayerSys.restoreState(p);
    }

    DB.mode.clear();
    DB.loc.clear();
    DB.active.clear();
    DB.reachedEnd.clear();

    state.time = 0;
    Utils.updateTimeState(CONFIG.DEF_LIMIT);
    state.displayString = "";

    Utils.broadcastSound("note.bass");

    if (state.loopId) {
      system.clearRun(state.loopId);
      state.loopId = null;
    }
  },

  fail() {
    state.isRunning = false;
    Utils.broadcastMsg("§c[!] หมดเวลาแล้ว! §gเกมจบลง");
    Utils.broadcastSound("mob.wither.death");

    for (const p of DB.active) {
      if (p.isValid) p.setGameMode(GameMode.Spectator);
    }

    state.time = 0;
    Utils.updateTimeState(CONFIG.DEF_LIMIT);
    state.displayString = "";

    if (state.loopId) {
      system.clearRun(state.loopId);
      state.loopId = null;
    }
  },

  win() {
    if (!state.isRunning) return;
    state.isRunning = false;

    const stats = {
      start: Utils.formatTime(0, state.initialMax),
      total: Utils.formatTime(0, state.max),
      bonus: Utils.formatTime(0, CONFIG.END_BONUS),
      used: Utils.formatTime(0, state.time),
      left: Utils.formatTime(state.time, state.max),
    };

    Utils.broadcastMsg(`=== ภารกิจสำเร็จ! สังหาร Ender Dragon ได้แล้ว ===`);
    Utils.broadcastMsg(CONFIG.MSG_HEADER);
    Utils.broadcastMsg(`* เวลาเริ่มต้น: §7${stats.start}`);
    Utils.broadcastMsg(`* โบนัสเวลาที่ได้: §7${stats.bonus}`);
    Utils.broadcastMsg(`* เวลาทั้งหมดที่มี: ${stats.total}`);
    Utils.broadcastMsg(`* เวลาที่ใช้ไป: ${stats.used}`);
    Utils.broadcastMsg(`* เวลาที่เหลืออยู่: ${stats.left}`);
    Utils.broadcastMsg(CONFIG.MSG_HEADER);
    Utils.broadcastMsg(`§7(พิมพ์ /addon:run reset เพื่อเริ่มเกมใหม่)`);
    Utils.broadcastSound("ui.toast.challenge_complete");
    Utils.broadcastSound("random.levelup");

    if (state.loopId) {
      system.clearRun(state.loopId);
      state.loopId = null;
    }
  },

  addBonus(player) {
    if (!state.isRunning || DB.reachedEnd.has(player.id)) return;

    DB.reachedEnd.add(player.id);
    Utils.updateTimeState(state.max + CONFIG.END_BONUS);

    Utils.broadcastMsg(`§d[+] เข้าถึงมิติ The End แล้ว! เพิ่มโบนัสเวลา ${Utils.formatTime(0, CONFIG.END_BONUS)}`);
    Utils.broadcastSound("random.levelup");
  },

  tick() {
    if (!state.isRunning) return;

    const currentTimeStr = Utils.formatTime(state.time, state.max);
    const actionMsg = `§c${currentTimeStr} §7/ ${state.displayString}`;

    for (const p of DB.active) {
      if (p.isValid) p.onScreenDisplay.setActionBar(actionMsg);
    }

    if (state.time >= state.max) {
      this.fail();
      return;
    }

    state.time += 20;
    if (state.max - state.time <= 200) {
      Utils.broadcastSound("note.pling");
    }
  },
};

system.beforeEvents.startup.subscribe((ev) => {
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
        if (mode === "start") Game.start(origin.sourceEntity, time);
        if (mode === "reset") Game.stop();
      });
      return { status: CustomCommandStatus.Success };
    }
  );
});

world.afterEvents.playerJoin.subscribe((ev) => {
  const p = world.getAllPlayers().find((x) => x.id === ev.playerId);
  if (p) PlayerSys.register(p);
});

world.afterEvents.playerLeave.subscribe((ev) => {
  PlayerSys.unregister(ev.playerId);
});

world.afterEvents.playerDimensionChange.subscribe((ev) => {
  if (ev.toDimension.id === "minecraft:the_end" && ev.player?.isValid) {
    Game.addBonus(ev.player);
  }
});

world.afterEvents.entityDie.subscribe((ev) => {
  if (state.isRunning && ev.deadEntity.typeId === "minecraft:ender_dragon") {
    Game.win();
  }
});
