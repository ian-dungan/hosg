// Moderation blocklist for names: English profanity, slurs and sexual terms.
// Entries are in normalised form (see names.ts): lower-case letters only, with any letter repeated
// in a row written once ("bollocks" is "bolocks"). A name is refused when its normalised form
// contains an entry, so very short or common fragments that sit inside innocent names ("ass" in
// Thomas, "hell" in Michelle, "cum" in Cucumber) are left out in favour of longer forms.

export const BAD_WORDS: readonly string[] = [
  // Profanity
  'fuck', 'fucker', 'fucking', 'fuckhead', 'fuckface', 'motherfucker', 'phuck', 'fvck', 'fuk', 'fukin', 'fuker',
  'shit', 'shite', 'bulshit', 'dipshit', 'shithead', 'horseshit', 'batshit',
  'cunt', 'kunt',
  'bitch', 'biatch', 'bitchy',
  'bastard', 'bolocks', 'buger', 'wanker', 'wanking', 'twat', 'prick', 'douche', 'douchebag', 'skank',
  'cock', 'cocksucker', 'cockhead', 'dick', 'dickhead', 'dickwad',
  'ashole', 'arsehole', 'arsewipe', 'jackas', 'dumbas', 'fatas', 'smartas', 'kickas', 'badas', 'asface', 'ashat', 'aswipe',
  'pisof', 'pised', 'pising', 'pistake', 'jerkof', 'toser', 'godamn', 'damnit', 'sonofabitch',
  'craphead', 'scumbag',

  // Sexual terms
  'sex', 'sexy', 'porn', 'porno', 'penis', 'vagina', 'vulva', 'clit', 'clitoris', 'dildo', 'vibrator',
  'orgasm', 'orgasim', 'cumshot', 'cumslut', 'cumdump', 'jiz', 'sperm', 'blowjob', 'handjob', 'rimjob',
  'fotjob', 'analsex', 'butsex', 'butplug', 'boner', 'erection', 'slut', 'whore', 'hoebag', 'milf', 'tities',
  'titfuck', 'niple', 'masturbat', 'fap', 'bukake', 'gangbang', 'depthroat', 'cunilingus', 'felatio',
  'pedophil', 'pedofil', 'paedo', 'molest', 'incest', 'bestiality', 'zophil', 'necrophil', 'nympho', 'hentai',
  'creampie', 'smegma', 'felch', 'quef', 'scrotum', 'testicle', 'bolock', 'nutsack', 'balsack', 'pusy', 'pusies',
  'twatwafle', 'horndog', 'upskirt', 'camgirl', 'stripclub', 'hoker', 'pimping',
  'sexslave', 'rapist', 'rapey',

  // Slurs
  'niger', 'niga', 'nigah', 'nigaz', 'negro', 'chink', 'wetback', 'beaner', 'kike', 'kyke', 'fagot',
  'fagit', 'fagy', 'dyke', 'trany', 'shemale', 'retard', 'retarded', 'raghead', 'towelhead', 'sandniger',
  'junglebuny', 'porchmonkey', 'honky', 'goliwog', 'jigabo', 'spearchucker', 'ziperhead', 'slanteye',
  'gypo', 'pikey', 'lesbo', 'homo', 'spaz', 'spastic', 'mongoloid', 'criple',
  'nazi', 'hitler', 'siegheil', 'heilhitler', 'whitepower', 'kukluxklan',
];
