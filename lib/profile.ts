// Amruta's profile. Defaults the app to her, while the questions stay reusable.
export const PROFILE = {
  name: "Amruta",
  nicknames: ["Kippa", "Kaddu", "Siltu", "Gulpanag", "Gurphaal Siganjan", "Manglu", "Nates", "Kippu", "Katoch", "Gullu Singh Lamba", "Gurcharan", "Gullu", "Gullu Gulshan", "Kiplani", "Gurleen Singh Pannu"],
  homeArea: "Marol, Andheri East",
  birthday: "2026-07-08", // Wednesday
  // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  vegDays: [1, 4, 6], // Monday, Thursday, Saturday: pure vegetarian
  noMeat: ["mutton", "lamb", "beef", "pork"], // eats only chicken and fish
  dislikes: ["mushroom", "capsicum", "oily" , "spicy"],
  loves: ["dessert", "nature", "lowcrowd", "instagrammable", "exoticfruit", "brunch", "waterfall", "lakeside", "forest", "sizzler", "shopping", "thrift", "temple", "serene", "muscat", "arabic", "sunset", "spa"],
  misses: "Muscat (20 years there), so an Omani/Arabic touch always lands.",
  nostalgia: ["muscat", "arabic", "middleeastern"],
  transport: {
    publicOption: "Metro from Marol Naka or Andheri, then a short auto for the last stretch.",
    privateOption: "Your bike (quick, easy parking) or the car for longer or rainy legs.",
  },
}
export function randomNickname() {
  return PROFILE.nicknames[Math.floor(Math.random() * PROFILE.nicknames.length)];
}
