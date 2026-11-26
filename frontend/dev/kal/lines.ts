// The couplets, and the halls' names (docs/temple/WORDS.md D; he reads them once as a Tamil reader
// before this design is shown in the Themes window). Every line compared with Project Madurai's text;
// the English is ours. None of the first chapter's, none that names a god.

export type CoupletText = { rows: [string, string]; says: string };

export const PLACES = {
  time: "சங்கிலி",
  resume: "செப்பேடு",
  skills: ["மண்டபம்", "கோலம்", "தோரணம்", "வாய்க்கால்", "தேர்", "பலகணி"],
  edu: "கருவூலம்",
  rec: "பொற்றாமரை",
  side: "துலாக்கோல்",
  vol: "அகல்",
  shell: "மணல்",
  well: "கேணி",
};

export const COUPLETS = {
  time: { rows: ["ஞாலம் கருதினுங் கைகூடுங் காலம்", "கருதி இடத்தாற் செயின்"], says: "At the right time, in the right place, even the world comes within reach." },
  resume: { rows: ["சொல்லுதல் யார்க்கும் எளிய அரியவாம்", "சொல்லிய வண்ணம் செயல்"], says: "To say it is easy for anyone. To do it as it was said is hard." },
  skills: [
    { rows: ["நீர்இன்று அமையாது உலகெனின் யார்யார்க்கும்", "வான்இன்று அமையாது ஒழுக்கு"], says: "Without water there is no world; without the cloud, no flow for anyone." },
    { rows: ["எண்ணென்ப ஏனை எழுத்தென்ப இவ்விரண்டும்", "கண்ணென்ப வாழும் உயிர்க்கு"], says: "Numbers and letters: these two are the eyes of the living." },
    { rows: ["எப்பொருள் யார்யார்வாய்க் கேட்பினும் அப்பொருள்", "மெய்ப்பொருள் காண்ப தறிவு"], says: "Whoever says it, to find what is true in it: that is wisdom." },
    { rows: ["கடனறிந்து காலங் கருதி இடனறிந்து", "எண்ணி உரைப்பான் தலை"], says: "The best messenger knows the duty, the time and the place, and thinks before speaking." },
    { rows: ["எண்ணித் துணிக கருமம் துணிந்தபின்", "எண்ணுவம் என்பது இழுக்கு"], says: "Think, then begin. “We will think once it has begun” is the fault." },
    { rows: ["இதனை இதனால் இவன்முடிக்கும் என்றாய்ந்து", "அதனை அவன்கண் விடல்"], says: "This work, by this means, this one can finish: weigh that, and leave it in those hands." },
  ] as CoupletText[],
  edu: { rows: ["கற்க கசடறக் கற்பவை கற்றபின்", "நிற்க அதற்குத் தக"], says: "Learn, and learn without fault; then stand by what you learned." },
  rec: { rows: ["வெள்ளத் தனைய மலர்நீட்டம் மாந்தர்தம்", "உள்ளத் தனையது உயர்வு"], says: "The lotus stands as tall as its water; a person, as tall as their heart." },
  side: { rows: ["ஆகாறு அளவிட்டி தாயினுங் கேடில்லை", "போகாறு அகலாக் கடை"], says: "Little may come in, and no harm done, if no more goes out." },
  vol: { rows: ["பகுத்துண்டு பல்லுயிர் ஓம்புதல் நூலோர்", "தொகுத்தவற்றுள் எல்லாந் தலை"], says: "Share your food and care for every life: of all that books have gathered, this is first." },
  shell: { rows: ["சொல்லுக சொல்லைப் பிறிதோர்சொல் அச்சொல்லை", "வெல்லுஞ்சொல் இன்மை அறிந்து"], says: "Say a word when you know no other word can better it." },
  well: { rows: ["தொட்டனைத் தூறும் மணற்கேணி மாந்தர்க்குக்", "கற்றனைத் தூறும் அறிவு"], says: "Dig deeper in sand and more water comes; learn more, and more is known." },
} satisfies Record<string, CoupletText | CoupletText[]>;
