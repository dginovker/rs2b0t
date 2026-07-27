import type { AbstractBot } from '../api/Bot.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import QuestDashboard from '../quests/QuestDashboard.js';
import AgilityBot, { AGILITY_SETTINGS } from './AgilityBot.js';
import AIOQuester, { AIO_SETTINGS } from './AIOQuester.js';
import ArdyCakes, { SETTINGS as ARDYCAKES_SETTINGS } from './ArdyCakes.js';
import ArdyFighter, { SETTINGS as ARDY_SETTINGS } from './ArdyFighter.js';
import ArdyThiever, { SETTINGS as ARDYTHIEVER_SETTINGS } from './ArdyThiever.js';
import AutoFighter, { SETTINGS as AUTOFIGHTER_SETTINGS } from './AutoFighter.js';
import BankFletcher, { SETTINGS as BANKFLETCHER_SETTINGS } from './BankFletcher.js';
import BoneBurier, { BONE_BURIER_SETTINGS } from './BoneBurier.js';
import ChaosDruidKiller, { SETTINGS as CHAOSDRUID_SETTINGS } from './ChaosDruidKiller.js';
import ChickenKiller, { SETTINGS as CHICKEN_SETTINGS } from './ChickenKiller.js';
import ClueSolver, { SETTINGS as CLUESOLVER_SETTINGS } from './ClueSolver.js';
import CookBot, { SETTINGS as COOKBOT_SETTINGS } from './CookBot.js';
import CowKiller, { SETTINGS as COWKILLER_SETTINGS } from './CowKiller.js';
import EdgevilleMonkeyBars, { EDGEVILLE_MONKEYBARS_SETTINGS } from './EdgevilleMonkeyBars.js';
import EssMiner, { SETTINGS as ESSMINER_SETTINGS } from './EssMiner.js';
import Firemaker, { FIREMAKER_SETTINGS } from './Firemaker.js';
import { LOCATION_OPTIONS } from './FishingLocations.js';
import { FISHING_METHOD_OPTIONS } from './FishingMethods.js';
import FlaxPicker, { SETTINGS as FLAXPICKER_SETTINGS } from './FlaxPicker.js';
import FlaxSpinner, { SETTINGS as FLAXSPINNER_SETTINGS } from './FlaxSpinner.js';
import GatheringBot, { GATHERING_SETTINGS } from './GatheringBot.js';
import GreenDragon, { SETTINGS as GREENDRAGON_SETTINGS } from './GreenDragon.js';
import LeatherCrafter, { CRAFTER_SETTINGS } from './LeatherCrafter.js';
import { ROCK_OPTIONS } from './MiningRocks.js';
import MossGiant, { SETTINGS as MOSSGIANT_SETTINGS } from './MossGiant.js';
import NatureCrafter, { SETTINGS as NATURECRAFTER_SETTINGS } from './NatureCrafter.js';
import RockCrab, { SETTINGS as ROCKCRAB_SETTINGS } from './RockCrab.js';
import RuneCrafter, { SETTINGS as RUNECRAFTER_SETTINGS } from './RuneCrafter.js';
import ShopBuyout, { SHOPBUYOUT_SETTINGS } from './ShopBuyout.js';
import { ShopRunner, SHOPRUNNER_SETTINGS } from './ShopRunner.js';
import SmelterBot, { SETTINGS as SMELTER_SETTINGS } from './SmelterBot.js';
import SmithingBot, { SETTINGS as SMITHING_SETTINGS } from './SmithingBot.js';
import TannerBot, { TANNER_SETTINGS } from './TannerBot.js';
import ThievingBot, { SETTINGS as THIEVING_SETTINGS } from './ThievingBot.js';
import TutorialBot from './TutorialBot.js';
import WalkToBot, { WALKTO_SETTINGS } from './WalkToBot.js';
import WildyAgility, { WILDY_AGILITY_SETTINGS } from './WildyAgility.js';
import Woodcutter, { SETTINGS as WOODCUTTER_SETTINGS } from './Woodcutter.js';

type BotClass = new () => AbstractBot;
type Script = [name: string, description: string, category: string, tags: string[], bot: BotClass, settings?: SettingsSchema];

const MINER_SETTINGS: SettingsSchema = {
    rocks: { type: 'string[]', default: ['Iron'], options: ROCK_OPTIONS, label: 'Rock types', help: 'which rocks to mine — every rock is named "Rocks" in-game, so pick the ore types here (multi-select). Empty = mine any rock.' },
    leashRadius: GATHERING_SETTINGS.leashRadius,
    location: { type: 'string', default: 'Auto', options: ['Auto', 'None'], label: 'Banking', help: 'Auto = web-walk to the nearest bank; None = drop it (power-mining).' }
};

const FISHER_SETTINGS: SettingsSchema = {
    fishMethod: {
        type: 'string',
        default: FISHING_METHOD_OPTIONS[0],
        options: FISHING_METHOD_OPTIONS,
        label: 'Fishing method',
        help: 'what to fish — picks the right spot (each spot offers a PAIR of ops) and the correct op of the two, e.g. small net (shrimp) vs big net (mackerel)'
    },
    leashRadius: { type: 'number', default: 12, min: 2, max: 30, label: 'Leash radius (tiles)' },
    location: {
        type: 'string',
        default: 'Auto',
        options: LOCATION_OPTIONS,
        label: 'Fishing location',
        help: 'Auto = bank the catch at the nearest bank (a known location if started at one, else the nearest booth in the scene); None = always drop (power-fishing)'
    }
};

const scripts: Script[] = [
    ['TutorialBot', 'Completes Tutorial Island unassisted (no cheats)', 'Tutorial', ['tutorial', 'onboarding'], TutorialBot],
    ['QuestDashboard', 'Reports DONE/READY/BLOCKED eligibility for all quests', 'Quest', ['quests', 'overlay', 'dashboard'], QuestDashboard],
    ['AIOQuester', 'All-in-one quest completer — queues the implemented quests (empty selection = all), provisions items bank-first, runs each to journal-complete', 'Quest', ['quest', 'queue', 'aio'], AIOQuester, AIO_SETTINGS],
    ['ChickenKiller', 'Kills chickens, loots and buries bones (anchor = start tile)', 'Combat', ['lumbridge', 'bones', 'feathers', 'afk'], ChickenKiller, CHICKEN_SETTINGS],
    ['CowKiller', 'Walks to Lumbridge or south-Falador cows, loots hides + bones, and supports Al Kharid toll banking', 'Combat', ['lumbridge', 'falador', 'cowhide', 'bones', 'banking', 'afk'], CowKiller, COWKILLER_SETTINGS],
    ['ChaosDruidKiller', 'Kills Chaos druids in the Edgeville dungeon, loots herbs/law runes, banks them', 'Combat', ['wilderness', 'edgeville', 'herbs', 'banking'], ChaosDruidKiller, CHAOSDRUID_SETTINGS],
    ['RockCrab', 'Rellekka rock crabs: aggro-stack-kill-reset, loots key halves', 'Combat', ['rellekka', 'keys', 'afk'], RockCrab, ROCKCRAB_SETTINGS],
    ['MossGiant', 'Moss giants N of Ardougne: range/mage safespot or melee, banks all loot', 'Combat', ['ardougne', 'safespot', 'afk'], MossGiant, MOSSGIANT_SETTINGS],
    ['GreenDragon', 'Wilderness green dragons N of Edgeville: melee/mage w/ anti-dragon shield, banks bones + hides', 'Combat', ['wilderness', 'dragons', 'hides'], GreenDragon, GREENDRAGON_SETTINGS],
    [
        'ArdyFighter',
        "Fights East Ardougne market guards, feeds itself from the Baker's stall, loots rares, banks them at the south bank, solves clue drops (needs melee stats that beat the 60s guard respawn — ~str 80 unarmed)",
        'Combat',
        ['ardougne', 'thieving', 'banking', 'clues', 'afk'],
        ArdyFighter,
        ARDY_SETTINGS
    ],
    ['Thiever', 'Pickpockets an NPC (Man by default); eats food when a failed steal hurts (anchor = start tile)', 'Thieving', ['pickpocket', 'coins'], ThievingBot, THIEVING_SETTINGS],
    [
        'AutoFighter',
        'Start-or-coordinate fighter — kills any named NPC in its leash, loots selected drops, auto-banks, solves clues, and returns to the killing spot',
        'Combat',
        ['combat', 'clues', 'banking', 'afk'],
        AutoFighter,
        AUTOFIGHTER_SETTINGS
    ],
    [
        'ArdyThiever',
        'Low-level East Ardougne pickpocket bot — steals cake for food, pickpockets Guard/Knight/Paladin/Hero, flees (kites) or fights the guard per the guardResponse setting, banks loot + junk, grabs ground coins, solves clue drops',
        'Thieving',
        ['ardougne', 'thieving', 'banking', 'clues', 'afk'],
        ArdyThiever,
        ARDYTHIEVER_SETTINGS
    ],
    [
        'ArdyCakes',
        "Baker's-stall cake thiever — steals on the golden stand, resets nearby when watched, banks full packs, flees (kites) or fights a catching guard per guardResponse, solves clue drops",
        'Thieving',
        ['ardougne', 'thieving', 'banking', 'clues', 'afk'],
        ArdyCakes,
        ARDYCAKES_SETTINGS
    ],
    ['Woodcutter', 'Chops trees and drops logs (anchor = start tile, needs an axe)', 'Woodcutting', ['gathering', 'drop'], Woodcutter, WOODCUTTER_SETTINGS],
    ['Miner', 'Mines the selected rock types and banks the ore at the nearest bank (auto-detected), or drops it. Needs a pickaxe.', 'Mining', ['gathering', 'banking', 'drop'], GatheringBot, MINER_SETTINGS],
    [
        'EssMiner',
        'Rune essence loop — Aubury teleport, one-click mine to a full pack, portal back, bank at Varrock East. Needs Rune Mysteries + a usable pickaxe (picks your best by default)',
        'Mining',
        ['varrock', 'mining', 'banking', 'afk'],
        EssMiner,
        ESSMINER_SETTINGS
    ],
    [
        'RuneCrafter',
        'AIO Runecrafting — withdraw essence + talisman, walk to the Mysterious ruins, use the talisman to enter, craft-rune at the altar, portal back, bank. Rune type via dropdown (Air for now, south of Falador)',
        'Runecrafting',
        ['runecrafting', 'banking', 'falador', 'afk'],
        RuneCrafter,
        RUNECRAFTER_SETTINGS
    ],
    [
        'NatureCrafter',
        'Master Nature Crafter — a master stands at the nature altar (Karamja), takes essence from configured runners via trade, and crafts natures; runners bank essence at Ardougne, un-note it at the general store, and ship it to the master. Mode + partner name(s) via settings',
        'Runecrafting',
        ['runecrafting', 'nature', 'trade', 'master', 'runner', 'karamja'],
        NatureCrafter,
        NATURECRAFTER_SETTINGS
    ],
    ['Fisher', 'Fishes a chosen method at the spot that offers it (each spot has a pair of ops); banks the catch at the nearest bank, or drops it (location: None)', 'Fishing', ['gathering', 'drop', 'banking'], GatheringBot, FISHER_SETTINGS],
    ['CookBot', 'Catherby cook loop — withdraw raw fish, cross to the range, cook it all one at a time, bank everything, repeat', 'Cooking', ['catherby', 'cooking', 'banking', 'afk'], CookBot, COOKBOT_SETTINGS],
    ['BankFletcher', 'Bank-standing fletcher — withdraw logs, knife-fletch the chosen product (arrow shafts / unstrung bow), deposit, repeat', 'Fletching', ['fletching', 'banking', 'afk'], BankFletcher, BANKFLETCHER_SETTINGS],
    ['BoneBurier', 'Bank-standing Prayer trainer — withdraws full loads of an exact bone name and buries them until the bank is empty', 'Prayer', ['prayer', 'bones', 'banking', 'afk'], BoneBurier, BONE_BURIER_SETTINGS],
    ['SmelterBot', 'Al Kharid smelter — withdraw ore, use it on the Furnace to smelt bars (all 8 bar types), bank, repeat', 'Smithing', ['smithing', 'smelting', 'banking', 'afk'], SmelterBot, SMELTER_SETTINGS],
    ['SmithingBot', 'Varrock anvil smithing — withdraw bars + a hammer, make the chosen item at the anvil, bank the products, repeat', 'Smithing', ['smithing', 'anvil', 'banking', 'afk'], SmithingBot, SMITHING_SETTINGS],
    ['FlaxPicker', 'Seers flax field picker — pick flax until full, bank it at Seers, repeat', 'Crafting', ['seers', 'gathering', 'banking', 'afk'], FlaxPicker, FLAXPICKER_SETTINGS],
    ['FlaxSpinner', 'Seers flax spinner — withdraw flax, climb to the spinning wheel, Spin-X into bow string, bank, repeat', 'Crafting', ['seers', 'crafting', 'banking', 'afk'], FlaxSpinner, FLAXSPINNER_SETTINGS],
    ['GnomeCourse', 'Runs the Gnome Stronghold agility course (start at the log balance)', 'Agility', ['course', 'gnome'], AgilityBot, AGILITY_SETTINGS],
    [
        'WildyAgility',
        'Runs the Wilderness Agility Course, eats while running, and on death banks (food-only) then returns — needs Agility 52 + carried food (start at the entrance)',
        'Agility',
        ['course', 'wilderness', 'food', 'death-recovery'],
        WildyAgility,
        WILDY_AGILITY_SETTINGS
    ],
    [
        'EdgevilleMonkeyBars',
        'Edgeville dungeon monkey bars — restock via dungeon ladder or after death. NOT RECOMMENDED FOR 10HP ACCOUNTS.',
        'Agility',
        ['edgeville', 'dungeon', 'monkey-bars', 'wilderness', 'banking'],
        EdgevilleMonkeyBars,
        EDGEVILLE_MONKEYBARS_SETTINGS
    ],
    [
        'ShopBuyout',
        "Parks at ONE shop and buys it out repeatedly on a total gp budget — no routing. Defaults to Lundail's Mage Arena rune shop (banks via Gundai's dialog); get the bot to the shop yourself.",
        'Money making',
        ['wilderness', 'shopping', 'banking', 'runes', 'afk'],
        ShopBuyout,
        SHOPBUYOUT_SETTINGS
    ],
    [
        'ShopRunner',
        'World shop-run supply loop — cycles shop clusters buying feathers, runes, and arrows/arrowtips, banking between clusters with capped gp withdrawals; skips shops until stock regenerates',
        'Money making',
        ['shopping', 'banking', 'worldwalker'],
        ShopRunner,
        SHOPRUNNER_SETTINGS
    ],
    [
        'ClueSolver',
        'Solves the easy clue scroll (or opens the casket) in your pack — banks everything except clue/food/spade at the nearest bank, walks the trail, opens the reward. Idles until you hand it a clue.',
        'Treasure Trails',
        ['clues', 'banking', 'utility'],
        ClueSolver,
        CLUESOLVER_SETTINGS
    ],
    [
        'WalkTo',
        'Walks to a chosen destination and stops — Lumbridge, Varrock, Falador, Ardougne, Rellekka, Taverley (centre); Draynor, Al Kharid, Edgeville, Seers, Yanille (bank); or a custom tile',
        'Navigation',
        ['navigation', 'utility', 'web-walk'],
        WalkToBot,
        WALKTO_SETTINGS
    ],
    [
        'TannerBot',
        "Al Kharid tanning loop — banks hides, tans the whole load in one click at the Tanner, and every Nth trip keeps a slot free to buy out Dommik's thread",
        'Crafting',
        ['alkharid', 'leather', 'dragonhide', 'banking', 'afk'],
        TannerBot,
        TANNER_SETTINGS
    ],
    ['LeatherCrafter', 'Needle-and-thread crafting loop — banks for leather and makes the best item your Crafting level allows for it', 'Crafting', ['crafting', 'leather', 'dragonhide', 'banking', 'afk'], LeatherCrafter, CRAFTER_SETTINGS],
    ['Firemaker', 'Banks logs and burns them along the longest clear lane next to the bank — Varrock east/west, Draynor or Seers', 'Firemaking', ['firemaking', 'banking', 'varrock', 'draynor', 'seers', 'afk'], Firemaker, FIREMAKER_SETTINGS]
];

for (const [name, description, category, tags, Bot, settingsSchema] of scripts) {
    ScriptRegistry.register({ name, description, category, tags, settingsSchema, create: () => new Bot() });
}
