export const MIX_RECIPES: Array<{ a: string; b: string; result: string }> = [
  { a: 'health_potion',      b: 'apple_juice',        result: 'invulnerability_potion' },
  { a: 'speed_potion',       b: 'translucence_potion', result: 'second_life_potion'    },
  { a: 'experience_potion',  b: 'phasing_potion',      result: 'transformation_potion' },
  { a: 'depredation_potion', b: 'blindness_potion',    result: 'music_potion'          },
]
export const SKILLED_POOL  = ['second_life_potion', 'invulnerability_potion', 'music_potion', 'transformation_potion']
export const MYSTERY_POOL  = ['speed_potion', 'phasing_potion', 'depredation_potion', 'strength_potion', 'experience_potion', 'blindness_potion', 'translucence_potion']

// Non-npc monsters strong enough to be worth becoming; excludes legendary uniques (e.g. jormungand, guardian).
export const POWERFUL_MONSTER_IDS = [
  'troll', 'lowerdwarf', 'swordsman', 'icedragon', 'firedragon', 'lorkest',
  'muddman', 'summoner', 'watcher', 'ogre', 'rockgiant', 'magician', 'qivuit',
  'squid', 'wizard', 'sorcerer', 'werewolf', 'hamster', 'blauwkip',
]
