/**
 * Data for the Preservation modal's Timeline section (js/ui/about-timeline.js renders it).
 * Kept separate from the renderer so the ~150 entries don't drown the logic.
 * Generated from modals/about.html's prior static markup — edit here, not there.
 */

const ABOUT_TIMELINE_ENTITY_LABELS = {
 "arpanet": "ARPANET",
 "usenet": "Usenet",
 "google-groups": "Google Groups",
 "deja-news": "Deja News",
 "aol": "America Online (AOL)",
 "gif": "GIF",
 "compuserve": "CompuServe",
 "adobe": "Adobe",
 "photoshop": "Adobe Photoshop",
 "jasc": "JASC",
 "paint-shop-pro": "Paint Shop Pro",
 "world-wide-web": "World Wide Web",
 "worldwideweb-browser": "WorldWideWeb / Nexus",
 "tripod": "Tripod",
 "mosaic": "NCSA Mosaic",
 "netscape": "Netscape Navigator",
 "w3c": "World Wide Web Consortium (W3C)",
 "geocities": "GeoCities",
 "the-palace": "The Palace",
 "newgrounds": "Newgrounds",
 "frontpage": "Microsoft FrontPage",
 "microsoft": "Microsoft",
 "internet-explorer": "Internet Explorer",
 "windows": "Windows 95",
 "purikura": "Purikura",
 "dollz": "Dollz",
 "altavista": "AltaVista",
 "angelfire": "Angelfire",
 "macromedia": "Macromedia",
 "flash": "Flash",
 "internet-archive": "Internet Archive",
 "icq": "ICQ",
 "homestead": "Homestead",
 "fortunecity": "FortuneCity",
 "aim": "AOL Instant Messenger (AIM)",
 "mozilla": "Mozilla",
 "yahoo": "Yahoo!",
 "adobe-imageready": "Adobe ImageReady",
 "google": "Google",
 "aol-hometown": "AOL Hometown",
 "albino-blacksheep": "Albino Blacksheep",
 "livejournal": "LiveJournal",
 "napster": "Napster",
 "msn-messenger": "MSN Messenger",
 "blogger": "Blogger",
 "xanga": "Xanga",
 "neopets": "Neopets",
 "yahoo-photos": "Yahoo! Photos",
 "deviantart": "DeviantArt",
 "limewire": "LimeWire",
 "yahoo-groups": "Yahoo! Groups",
 "habbo": "Habbo Hotel",
 "wayback-machine": "Wayback Machine",
 "friendster": "Friendster",
 "gaia-online": "Gaia Online",
 "hi5": "Hi5",
 "imageshack": "ImageShack",
 "photobucket": "Photobucket",
 "myspace": "MySpace",
 "skype": "Skype",
 "delicious": "Delicious",
 "orkut": "Orkut",
 "facebook": "Facebook",
 "flickr": "Flickr",
 "yahoo-search": "Yahoo! Search",
 "tinypic": "TinyPic",
 "firefox": "Firefox",
 "boomspeed": "Boomspeed",
 "bebo": "Bebo",
 "youtube": "YouTube",
 "google-reader": "Google Reader",
 "piczo": "Piczo",
 "blingee": "Blingee",
 "twitter": "Twitter",
 "polyvore": "Polyvore",
 "tumblr": "Tumblr",
 "we-heart-it": "We Heart It",
 "chrome": "Google Chrome",
 "whatsapp": "WhatsApp",
 "bing": "Bing",
 "pinterest": "Pinterest",
 "instagram": "Instagram",
 "vine": "Vine",
 "snapchat": "Snapchat",
 "giphy": "GIPHY",
 "creative-cloud": "Creative Cloud",
 "neocities": "Neocities",
 "tenor": "Tenor",
 "edge": "Microsoft Edge",
 "gifcities": "GifCities",
 "yahoo-messenger": "Yahoo! Messenger",
 "klipy": "Klipy",
 "x": "X",
 "atlus": "Atlus",
 "automattic": "Automattic",
 "bauer": "Bauer Media Group",
 "communities-com": "Communities.com",
 "corel": "Corel",
 "crowdgather": "CrowdGather",
 "elon-musk": "Elon Musk",
 "expage": "Expage",
 "ezboard": "ezboard",
 "freewebs": "Freewebs",
 "futuresplash": "FutureSplash Animator",
 "geocities-japan": "GeoCities Japan",
 "intuit": "Intuit",
 "invisionfree": "InvisionFree",
 "lycos": "Lycos",
 "meta": "Meta",
 "mia": "M.I.A.",
 "news-corp": "News Corp",
 "oath": "Oath",
 "proboards": "ProBoards",
 "sega": "Sega",
 "shutterstock": "Shutterstock",
 "specific-media": "Specific Media",
 "ssense": "SSENSE",
 "steve-wilhite": "Steve Wilhite",
 "tapatalk": "Tapatalk",
 "verizon": "Verizon",
 "verticalscope": "VerticalScope",
 "vistaprint": "Vistaprint",
 "webs": "Webs",
 "webtv": "WebTV",
 "mica": "Mica",
 "dan-411": "Dan (DAN-411)",
 "whowhere": "WhoWhere",
 "yahoo-japan": "Yahoo! Japan",
 "yuku": "Yuku",
 "zathyus": "Zathyus Networks",
 "zetaboards": "ZetaBoards"
};

const ABOUT_TIMELINE_TAG_LABELS = {
 "archive": "Archiving",
 "bookmarking": "Bookmarking",
 "browser": "Browsers",
 "cache": "Caching",
 "dollmaker": "Dollmakers",
 "fashion": "Fashion",
 "file-sharing": "File Sharing",
 "format": "File Formats",
 "forum": "Forums",
 "game": "Games",
 "gif-platform": "GIF Platforms",
 "hosting": "Web Hosting",
 "infrastructure": "Infrastructure",
 "isp": "ISPs",
 "messaging-app": "Messaging Apps",
 "music-art": "Music & Art",
 "operating-system": "Operating Systems",
 "person": "People",
 "photo-booth": "Photo Booths",
 "photo-site": "Photo/Image Hosting",
 "program": "Creative Tools",
 "rss": "RSS",
 "search-engine": "Search Engines",
 "social-network": "Social Networks",
 "standards": "Web Standards",
 "video-platform": "Video Platforms",
 "virtual-world": "Virtual Worlds",
 "web-animation": "Web Animation"
};

const ABOUT_TIMELINE_COUNTRY_LABELS = {
 "at": "Austria",
 "br": "Brazil",
 "ca": "Canada",
 "fi": "Finland",
 "gb": "United Kingdom",
 "ge": "Georgia",
 "il": "Israel",
 "international": "International",
 "jp": "Japan",
 "us": "United States"
};

const ABOUT_TIMELINE = [
 {
  "date": "1969",
  "type": "start",
  "tags": [
   "infrastructure"
  ],
  "entities": [
   "arpanet"
  ],
  "country": "us",
  "year": 1969,
  "decade": "1960s",
  "html": "<strong>ARPANET</strong> sends its first message, the starting point for what would evolve into the modern internet."
 },
 {
  "date": "1980",
  "type": "start",
  "tags": [
   "forum"
  ],
  "entities": [
   "usenet"
  ],
  "country": "us",
  "year": 1980,
  "decade": "1980s",
  "html": "<strong>Usenet</strong> is established, a worldwide distributed discussion system built on the Unix-to-Unix Copy (UUCP) dial-up network architecture. Tom Truscott and Jim Ellis had conceived the idea the year before, in 1979."
 },
 {
  "date": "1 May 1985",
  "type": "start",
  "tags": [
   "isp"
  ],
  "entities": [
   "aol"
  ],
  "country": "us",
  "year": 1985,
  "decade": "1980s",
  "html": "Quantum Computer Services launches the Q-Link online service for Commodore 64 users; it's renamed <strong>America Online (AOL)</strong> in 1989."
 },
 {
  "date": "15 Jun 1987",
  "type": "start",
  "tags": [
   "format"
  ],
  "entities": [
   "gif",
   "compuserve"
  ],
  "country": "us",
  "year": 1987,
  "decade": "1980s",
  "html": "The <strong>GIF</strong> format is released by a team at <strong>CompuServe</strong> led by Steve Wilhite."
 },
 {
  "date": "19 Feb 1990",
  "type": "start",
  "tags": [
   "program"
  ],
  "entities": [
   "adobe",
   "photoshop"
  ],
  "country": "us",
  "year": 1990,
  "decade": "1990s",
  "html": "<strong>Adobe Photoshop</strong> 1.0 is released."
 },
 {
  "date": "1990",
  "type": "start",
  "tags": [
   "program"
  ],
  "entities": [
   "jasc",
   "paint-shop-pro"
  ],
  "country": "us",
  "year": 1990,
  "decade": "1990s",
  "html": "<strong>JASC Paint Shop Pro</strong> is first released."
 },
 {
  "date": "1990",
  "type": "closure",
  "tags": [
   "infrastructure"
  ],
  "entities": [
   "arpanet"
  ],
  "country": "us",
  "year": 1990,
  "decade": "1990s",
  "html": "<strong>ARPANET</strong> is formally decommissioned, having fully evolved into the modern internet."
 },
 {
  "date": "1990",
  "type": "start",
  "tags": [
   "browser"
  ],
  "entities": [
   "worldwideweb-browser"
  ],
  "country": "international",
  "year": 1990,
  "decade": "1990s",
  "html": "Tim Berners-Lee creates the first browser, <strong>WorldWideWeb</strong>, at CERN."
 },
 {
  "date": "1991",
  "type": "start",
  "tags": [
   "infrastructure"
  ],
  "entities": [
   "world-wide-web"
  ],
  "country": "international",
  "year": 1991,
  "decade": "1990s",
  "html": "Tim Berners-Lee's <strong>World Wide Web</strong>, built at CERN two years earlier, is made publicly available."
 },
 {
  "date": "1991",
  "type": "start",
  "tags": [
   "isp"
  ],
  "entities": [
   "aol"
  ],
  "country": "us",
  "year": 1991,
  "decade": "1990s",
  "html": "<strong>AOL</strong> begins offering dial-up access to the wider internet, rather than just its own proprietary network."
 },
 {
  "date": "1992",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "tripod"
  ],
  "country": "us",
  "year": 1992,
  "decade": "1990s",
  "html": "<strong>Tripod</strong> is founded by Williams College classmates Bo Peabody and Brett Hershey with economics professor Dick Sabot, originally offering advice and tools for young adults rather than a web platform."
 },
 {
  "date": "1993",
  "type": "start",
  "tags": [
   "browser"
  ],
  "entities": [
   "mosaic"
  ],
  "country": "us",
  "year": 1993,
  "decade": "1990s",
  "html": "<strong>NCSA Mosaic</strong> popularizes graphical web browsing."
 },
 {
  "date": "15 Dec 1994",
  "type": "start",
  "tags": [
   "browser"
  ],
  "entities": [
   "netscape"
  ],
  "country": "us",
  "year": 1994,
  "decade": "1990s",
  "html": "<strong>Netscape Navigator</strong> 1.0 is released, becoming the dominant browser of the early commercial web."
 },
 {
  "date": "1 Oct 1994",
  "type": "start",
  "tags": [
   "standards"
  ],
  "entities": [
   "w3c"
  ],
  "country": "us",
  "year": 1994,
  "decade": "1990s",
  "html": "The <strong>World Wide Web Consortium (W3C)</strong> is founded by Tim Berners-Lee."
 },
 {
  "date": "1994",
  "type": "closure",
  "tags": [
   "browser"
  ],
  "entities": [
   "worldwideweb-browser"
  ],
  "country": "international",
  "year": 1994,
  "decade": "1990s",
  "html": "<strong>WorldWideWeb</strong>, renamed Nexus, is discontinued."
 },
 {
  "date": "Nov 1994",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "geocities",
   "yahoo"
  ],
  "country": "us",
  "year": 1994,
  "decade": "1990s",
  "html": "<strong>GeoCities</strong> is founded as Beverly Hills Internet — widely credited as the first major free personal-website hosting service (renamed GeoCities in 1995)."
 },
 {
  "date": "1994",
  "type": "start",
  "tags": [
   "virtual-world"
  ],
  "entities": [
   "the-palace"
  ],
  "country": "us",
  "year": 1994,
  "decade": "1990s",
  "html": "Jim Bumgardner begins developing <strong>The Palace</strong> at Time Warner Interactive."
 },
 {
  "date": "1995",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "tripod"
  ],
  "country": "us",
  "year": 1995,
  "decade": "1990s",
  "html": "As the Web expands, <strong>Tripod</strong> pivots to offering free, ad-supported homepage building and hosting."
 },
 {
  "date": "1995",
  "type": "start",
  "tags": [
   "web-animation"
  ],
  "entities": [
   "newgrounds"
  ],
  "country": "us",
  "year": 1995,
  "decade": "1990s",
  "html": "<strong>Newgrounds</strong> begins as Tom Fulp's personal website, eventually growing into a major hub for independent web animation, games, and Flash culture."
 },
 {
  "date": "1995",
  "type": "start",
  "tags": [
   "program"
  ],
  "entities": [
   "frontpage",
   "microsoft"
  ],
  "country": "us",
  "year": 1995,
  "decade": "1990s",
  "html": "<strong>Microsoft FrontPage</strong> makes visual website building accessible to non-programmers."
 },
 {
  "date": "16 Aug 1995",
  "type": "start",
  "tags": [
   "browser"
  ],
  "entities": [
   "internet-explorer",
   "microsoft"
  ],
  "country": "us",
  "year": 1995,
  "decade": "1990s",
  "html": "<strong>Internet Explorer</strong> 1.0 is released, bundled with the Windows 95 Plus Pack."
 },
 {
  "date": "24 Aug 1995",
  "type": "start",
  "tags": [
   "operating-system"
  ],
  "entities": [
   "windows",
   "microsoft"
  ],
  "country": "us",
  "year": 1995,
  "decade": "1990s",
  "html": "<strong>Windows 95</strong> is released, bringing the internet and a PC within reach of the mainstream household for the first time."
 },
 {
  "date": "Feb 1995",
  "type": "start",
  "tags": [
   "photo-booth"
  ],
  "entities": [
   "purikura",
   "atlus",
   "sega"
  ],
  "country": "jp",
  "year": 1995,
  "decade": "1990s",
  "html": "<strong>Purikura</strong> (\"Print Club\") photo-sticker booths debut in Japan, developed by Atlus with Sega."
 },
 {
  "date": "Nov 1995",
  "type": "start",
  "tags": [
   "virtual-world"
  ],
  "entities": [
   "the-palace"
  ],
  "country": "us",
  "year": 1995,
  "decade": "1990s",
  "html": "<strong>The Palace</strong> launches publicly."
 },
 {
  "date": "Dec 1995",
  "type": "start",
  "tags": [
   "dollmaker"
  ],
  "entities": [
   "the-palace",
   "dollz"
  ],
  "country": "us",
  "year": 1995,
  "decade": "1990s",
  "html": "Melicia Greenwood creates her first <strong>doll</strong> on The Palace, a goth \"Barbie\" sized so six of its nine avatar props hold interchangeable clothing — the starting point for \"dollz,\" which soon diversify into skater, prep, and tiny styles before migrating off The Palace onto personal websites by the late 1990s."
 },
 {
  "date": "15 Dec 1995",
  "type": "start",
  "tags": [
   "search-engine"
  ],
  "entities": [
   "altavista"
  ],
  "country": "us",
  "year": 1995,
  "decade": "1990s",
  "html": "<strong>AltaVista</strong> launches, becoming the dominant search engine of the pre-Google web."
 },
 {
  "date": "1996",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "angelfire"
  ],
  "country": "us",
  "year": 1996,
  "decade": "1990s",
  "html": "<strong>Angelfire</strong> is founded, originally combining website building with an unrelated medical-transcription service."
 },
 {
  "date": "1996",
  "type": "start",
  "tags": [
   "forum"
  ],
  "entities": [
   "ezboard"
  ],
  "country": "us",
  "year": 1996,
  "decade": "1990s",
  "html": "<strong>ezboard</strong> launches as a free forum-hosting service."
 },
 {
  "date": "1996",
  "type": "acquisition",
  "tags": [
   "program"
  ],
  "entities": [
   "futuresplash",
   "macromedia",
   "flash"
  ],
  "country": "us",
  "year": 1996,
  "decade": "1990s",
  "html": "Macromedia acquires FutureWave Software and renames FutureSplash Animator to <strong>Macromedia Flash</strong>, beginning Flash's major role in web animation and interactive media."
 },
 {
  "date": "10 May 1996",
  "type": "start",
  "tags": [
   "archive"
  ],
  "entities": [
   "internet-archive"
  ],
  "country": "us",
  "year": 1996,
  "decade": "1990s",
  "html": "The <strong>Internet Archive</strong> is founded by Brewster Kahle, beginning the crawl-and-preserve project that would later save much of the era this timeline covers."
 },
 {
  "date": "1996",
  "type": "start",
  "tags": [
   "isp"
  ],
  "entities": [
   "webtv"
  ],
  "country": "us",
  "year": 1996,
  "decade": "1990s",
  "html": "<strong>WebTV</strong> launches, a set-top box and online service that let people browse the web and send email on a television instead of a computer. A small circle of WebTV users passing animations to one another by email in early 2001 is the traceable origin of the glitter tile family preserved in this editor."
 },
 {
  "date": "15 Nov 1996",
  "type": "start",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "icq"
  ],
  "country": "il",
  "year": 1996,
  "decade": "1990s",
  "html": "<strong>ICQ</strong> launches, one of the first mass-market instant messengers."
 },
 {
  "date": "Jan 1997",
  "type": "closure",
  "tags": [
   "browser"
  ],
  "entities": [
   "mosaic"
  ],
  "country": "us",
  "year": 1997,
  "decade": "1990s",
  "html": "Development and support for <strong>NCSA Mosaic</strong> ends."
 },
 {
  "date": "1997",
  "type": "acquisition",
  "tags": [
   "isp"
  ],
  "entities": [
   "webtv",
   "microsoft"
  ],
  "country": "us",
  "year": 1997,
  "decade": "1990s",
  "html": "Microsoft buys <strong>WebTV</strong> Networks."
 },
 {
  "date": "1997",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "homestead"
  ],
  "country": "us",
  "year": 1997,
  "decade": "1990s",
  "html": "<strong>Homestead</strong> is founded."
 },
 {
  "date": "1997",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "fortunecity"
  ],
  "country": "gb",
  "year": 1997,
  "decade": "1990s",
  "html": "<strong>FortuneCity</strong> launches as a free personal-web-hosting community, joining services such as GeoCities, Tripod, and Angelfire."
 },
 {
  "date": "1997",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "expage"
  ],
  "country": "us",
  "year": 1997,
  "decade": "1990s",
  "html": "<strong>Expage</strong> (Express Page) launches as a free personal-website hosting service."
 },
 {
  "date": "15 Sep 1997",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "geocities-japan",
   "geocities"
  ],
  "country": "jp",
  "year": 1997,
  "decade": "1990s",
  "html": "<strong>GeoCities Japan</strong> launches as a joint venture between the American GeoCities and SoftBank."
 },
 {
  "date": "1997",
  "type": "acquisition",
  "tags": [
   "hosting"
  ],
  "entities": [
   "angelfire",
   "whowhere"
  ],
  "country": "us",
  "year": 1997,
  "decade": "1990s",
  "html": "<strong>WhoWhere</strong> acquires <strong>Angelfire</strong>."
 },
 {
  "date": "1 May 1997",
  "type": "start",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "aim",
   "aol"
  ],
  "country": "us",
  "year": 1997,
  "decade": "1990s",
  "html": "<strong>AOL Instant Messenger (AIM)</strong> is released, introducing buddy lists, custom screen names, and away messages that became a major outlet for online self-expression."
 },
 {
  "date": "Jan 1998",
  "type": "start",
  "tags": [
   "browser"
  ],
  "entities": [
   "netscape",
   "mozilla"
  ],
  "country": "us",
  "year": 1998,
  "decade": "1990s",
  "html": "<strong>Netscape</strong> open-sources its browser code as the <strong>Mozilla</strong> project, the codebase that eventually becomes Firefox."
 },
 {
  "date": "9 Mar 1998",
  "type": "start",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "yahoo-messenger",
   "yahoo"
  ],
  "country": "us",
  "year": 1998,
  "decade": "1990s",
  "html": "<strong>Yahoo! Pager</strong> launches (renamed Yahoo! Messenger in 1999)."
 },
 
 {
  "date": "1998",
  "type": "start",
  "tags": [
   "program"
  ],
  "entities": [
   "adobe",
   "adobe-imageready"
  ],
  "country": "us",
  "year": 1998,
  "decade": "1990s",
  "html": "<strong>Adobe ImageReady</strong> 1.0 is released."
 },
 {
  "date": "Feb 1998",
  "type": "acquisition",
  "tags": [
   "hosting"
  ],
  "entities": [
   "tripod",
   "lycos"
  ],
  "country": "us",
  "year": 1998,
  "decade": "1990s",
  "html": "<strong>Lycos</strong> acquires <strong>Tripod</strong> for $58 million in stock."
 },
 {
  "date": "Aug 1998",
  "type": "acquisition",
  "tags": [
   "hosting"
  ],
  "entities": [
   "whowhere",
   "lycos",
   "angelfire"
  ],
  "country": "us",
  "year": 1998,
  "decade": "1990s",
  "html": "<strong>Lycos</strong> acquires <strong>WhoWhere</strong> for $133 million, bringing <strong>Angelfire</strong> under the same company as Tripod."
 },
 {
  "date": "4 Sep 1998",
  "type": "start",
  "tags": [
   "search-engine"
  ],
  "entities": [
   "google"
  ],
  "country": "us",
  "year": 1998,
  "decade": "1990s",
  "html": "<strong>Google</strong> is founded by Stanford PhD students Larry Page and Sergey Brin."
 },
 {
  "date": "Sep 1998",
  "type": "start",
  "tags": [
   "search-engine",
   "cache",
   "archive"
  ],
  "entities": [
   "google"
  ],
  "country": "us",
  "year": 1998,
  "decade": "1990s",
  "html": "<strong>Google</strong> launches publicly with a \"Cached\" link built into its search results from the start, letting people view a page's last-crawled snapshot even when the live site was unavailable."
 },
 {
  "date": "Oct 1998",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "aol-hometown",
   "aol"
  ],
  "country": "us",
  "year": 1998,
  "decade": "1990s",
  "html": "<strong>AOL Hometown</strong> launches, giving AOL subscribers free personal webpages."
 },
 {
  "date": "1998",
  "type": "acquisition",
  "tags": [
   "browser"
  ],
  "entities": [
   "netscape",
   "aol"
  ],
  "country": "us",
  "year": 1998,
  "decade": "1990s",
  "html": "<strong>AOL</strong> acquires <strong>Netscape</strong>."
 },
 {
  "date": "4 Jan 1999",
  "type": "start",
  "tags": [
   "web-animation"
  ],
  "entities": [
   "albino-blacksheep"
  ],
  "country": "ca",
  "year": 1999,
  "decade": "1990s",
  "html": "<strong>Albino Blacksheep</strong> launches, becoming a major hub for viral Flash animation and animutation in the early 2000s."
 },
 {
  "date": "28 Jan 1999",
  "type": "acquisition",
  "tags": [
   "hosting"
  ],
  "entities": [
   "geocities",
   "yahoo"
  ],
  "country": "us",
  "year": 1999,
  "decade": "1990s",
  "html": "Yahoo! announces its acquisition of <strong>GeoCities</strong> (completed that May)."
 },
 {
  "date": "18 Mar 1999",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "livejournal"
  ],
  "country": "us",
  "year": 1999,
  "decade": "1990s",
  "html": "<strong>LiveJournal</strong> launches, combining personal journals with social-networking features."
 },
 {
  "date": "1 Jun 1999",
  "type": "start",
  "tags": [
   "file-sharing"
  ],
  "entities": [
   "napster"
  ],
  "country": "us",
  "year": 1999,
  "decade": "1990s",
  "html": "<strong>Napster</strong> launches, founded by Shawn Fanning and Sean Parker, kicking off the peer-to-peer music-sharing era."
 },
 {
  "date": "22 Jul 1999",
  "type": "start",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "msn-messenger",
   "microsoft"
  ],
  "country": "us",
  "year": 1999,
  "decade": "1990s",
  "html": "<strong>MSN Messenger</strong> launches."
 },
 {
  "date": "23 Aug 1999",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "blogger"
  ],
  "country": "us",
  "year": 1999,
  "decade": "1990s",
  "html": "<strong>Blogger</strong> launches, created by Pyra Labs, helping popularize easy web-based blogging."
 },
 {
  "date": "1999",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "xanga"
  ],
  "country": "us",
  "year": 1999,
  "decade": "1990s",
  "html": "<strong>Xanga</strong> launches, initially focused on sharing book and music reviews before evolving into a major blogging and social-networking service."
 },
 {
  "date": "15 Nov 1999",
  "type": "start",
  "tags": [
   "game"
  ],
  "entities": [
   "neopets"
  ],
  "country": "gb",
  "year": 1999,
  "decade": "1990s",
  "html": "<strong>Neopets</strong> launches."
 },
 {
  "date": "1 Jan 2000",
  "type": "start",
  "tags": [
   "forum"
  ],
  "entities": [
   "proboards"
  ],
  "country": "us",
  "year": 2000,
  "decade": "2000s",
  "html": "<strong>ProBoards</strong> officially launches as a free forum-hosting service."
 },
 {
  "date": "1 Mar 2000",
  "type": "acquisition",
  "tags": [
   "hosting"
  ],
  "entities": [
   "geocities-japan",
   "yahoo-japan"
  ],
  "country": "jp",
  "year": 2000,
  "decade": "2000s",
  "html": "<strong>Yahoo! Japan</strong> absorbs <strong>GeoCities Japan</strong>, renaming it Yahoo! GeoCities Japan."
 },
 {
  "date": "28 Mar 2000",
  "type": "start",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "yahoo-photos",
   "yahoo"
  ],
  "country": "us",
  "year": 2000,
  "decade": "2000s",
  "html": "<strong>Yahoo! Photos</strong> launches as Yahoo!'s online photo-storage and sharing service."
 },
 {
  "date": "7 Aug 2000",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "deviantart"
  ],
  "country": "us",
  "year": 2000,
  "decade": "2000s",
  "html": "<strong>DeviantArt</strong> launches, developing into one of the web's largest communities for digital artists and fan-created artwork."
 },
 {
  "date": "2000",
  "type": "start",
  "tags": [
   "file-sharing"
  ],
  "entities": [
   "limewire"
  ],
  "country": "us",
  "year": 2000,
  "decade": "2000s",
  "html": "<strong>LimeWire</strong> is founded by Mark Gorton."
 },
 {
  "date": "2001",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "freewebs"
  ],
  "country": "us",
  "year": 2001,
  "decade": "2000s",
  "html": "<strong>Freewebs</strong> launches as a free personal-website hosting service."
 },
 {
  "date": "Early 2001",
  "type": "milestone",
  "tags": [
   "web-animation",
   "person"
  ],
  "entities": [
   "webtv",
   "mica",
   "dan-411"
  ],
  "country": "us",
  "year": 2001,
  "decade": "2000s",
  "html": "A small circle of <strong>WebTV</strong> users trading animations by email, later remembered as the \"Glitter Connection,\" produces the glitter tile family preserved in this editor. <strong>Mica</strong>'s tile becomes the shared basis; <strong>Dan</strong> recolors it into flat jewel tones under his own gemstone names."
 },
 {
  "date": "30 Jan 2001",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "yahoo-groups",
   "yahoo"
  ],
  "country": "us",
  "year": 2001,
  "decade": "2000s",
  "html": "<strong>Yahoo! Groups</strong> launches, combining mailing lists, forums, and file archives into one community platform (later peaking at over 100 million users)."
 },
 {
  "date": "Feb 2001",
  "type": "acquisition",
  "tags": [
   "forum"
  ],
  "entities": [
   "google",
   "google-groups",
   "deja-news",
   "usenet"
  ],
  "country": "us",
  "year": 2001,
  "decade": "2000s",
  "html": "Google acquires Deja.com's Usenet archive, <strong>Deja News</strong> (operational since March 1995), and relaunches it as <strong>Google Groups</strong>."
 },
 {
  "date": "Feb 2001",
  "type": "start",
  "tags": [
   "virtual-world"
  ],
  "entities": [
   "habbo"
  ],
  "country": "fi",
  "year": 2001,
  "decade": "2000s",
  "html": "<strong>Habbo Hotel</strong> launches internationally, letting users decorate pixel-art rooms and avatars in a shared virtual space, following the earlier 2000 Finnish original."
 },
 {
  "date": "11 Jul 2001",
  "type": "closure",
  "tags": [
   "file-sharing"
  ],
  "entities": [
   "napster"
  ],
  "country": "us",
  "year": 2001,
  "decade": "2000s",
  "html": "<strong>Napster</strong> shuts down its file-sharing service under a court injunction won by the RIAA."
 },
 {
  "date": "24 Oct 2001",
  "type": "start",
  "tags": [
   "archive"
  ],
  "entities": [
   "internet-archive",
   "wayback-machine"
  ],
  "country": "us",
  "year": 2001,
  "decade": "2000s",
  "html": "The <strong>Wayback Machine</strong> launches publicly, already containing over 10 billion archived pages."
 },
 {
  "date": "2001",
  "type": "closure",
  "tags": [
   "virtual-world"
  ],
  "entities": [
   "the-palace",
   "communities-com"
  ],
  "country": "us",
  "year": 2001,
  "decade": "2000s",
  "html": "Communities.com folds in the dot-com collapse, ending official development of <strong>The Palace</strong>; the community keeps it running independently."
 },
 {
  "date": "2002",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "friendster"
  ],
  "country": "us",
  "year": 2002,
  "decade": "2000s",
  "html": "<strong>Friendster</strong> is founded (it launches publicly the following year)."
 },
 {
  "date": "Sep 2002",
  "type": "start",
  "tags": [
   "forum"
  ],
  "entities": [
   "invisionfree",
   "zathyus"
  ],
  "country": "us",
  "year": 2002,
  "decade": "2000s",
  "html": "<strong>InvisionFree</strong> launches as a free remotely hosted forum service from Zathyus Networks."
 },
 {
  "date": "18 Feb 2003",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "gaia-online"
  ],
  "country": "us",
  "year": 2003,
  "decade": "2000s",
  "html": "<strong>Gaia Online</strong> launches as Go-Gaia.com (renamed Gaia Online in 2004)."
 },
 {
  "date": "2003",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "hi5"
  ],
  "country": "us",
  "year": 2003,
  "decade": "2000s",
  "html": "<strong>Hi5</strong> launches."
 },
 {
  "date": "2003",
  "type": "start",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "imageshack"
  ],
  "country": "us",
  "year": 2003,
  "decade": "2000s",
  "html": "<strong>ImageShack</strong> launches as a free image-hosting service widely used for externally hosted images on forums, blogs, and personal sites."
 },
 {
  "date": "May 2003",
  "type": "start",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "photobucket"
  ],
  "country": "us",
  "year": 2003,
  "decade": "2000s",
  "html": "<strong>Photobucket</strong> launches, becoming one of the dominant image hosts for forums, blogs, profiles, and personal websites."
 },
 {
  "date": "15 Jul 2003",
  "type": "start",
  "tags": [
   "browser"
  ],
  "entities": [
   "mozilla",
   "firefox"
  ],
  "country": "us",
  "year": 2003,
  "decade": "2000s",
  "html": "The <strong>Mozilla Foundation</strong> is founded to carry the browser project forward as AOL scales back its involvement."
 },
 {
  "date": "1 Aug 2003",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "myspace"
  ],
  "country": "us",
  "year": 2003,
  "decade": "2000s",
  "html": "<strong>MySpace</strong> launches."
 },
 {
  "date": "29 Aug 2003",
  "type": "start",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "skype"
  ],
  "country": "international",
  "year": 2003,
  "decade": "2000s",
  "html": "<strong>Skype</strong> is founded by Niklas Zennström (Sweden) and Janus Friis (Denmark), built by a team of Estonian engineers."
 },
 {
  "date": "Sep 2003",
  "type": "start",
  "tags": [
   "bookmarking"
  ],
  "entities": [
   "delicious"
  ],
  "country": "us",
  "year": 2003,
  "decade": "2000s",
  "html": "<strong>Delicious</strong> (del.icio.us) launches, popularizing social bookmarking and tagging."
 },
 {
  "date": "24 Jan 2004",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "orkut",
   "google"
  ],
  "country": "us",
  "year": 2004,
  "decade": "2000s",
  "html": "<strong>Orkut</strong> launches, becoming especially popular in Brazil and India."
 },
 {
  "date": "4 Feb 2004",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "facebook",
   "meta"
  ],
  "country": "us",
  "year": 2004,
  "decade": "2000s",
  "html": "<strong>Facebook</strong> launches."
 },
 {
  "date": "9 Feb 2004",
  "type": "start",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "flickr"
  ],
  "country": "ca",
  "year": 2004,
  "decade": "2000s",
  "html": "<strong>Flickr</strong> launches as an online photo-sharing community."
 },
 {
  "date": "Feb 2004",
  "type": "start",
  "tags": [
   "search-engine"
  ],
  "entities": [
   "yahoo-search",
   "yahoo"
  ],
  "country": "us",
  "year": 2004,
  "decade": "2000s",
  "html": "<strong>Yahoo! Search</strong> switches to its own in-house search index, ending its longtime reliance on Google to power results."
 },
 {
  "date": "2004",
  "type": "start",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "tinypic"
  ],
  "country": "us",
  "year": 2004,
  "decade": "2000s",
  "html": "<strong>TinyPic</strong> launches as a free image and video host."
 },
 {
  "date": "14 Oct 2004",
  "type": "acquisition",
  "tags": [
   "program"
  ],
  "entities": [
   "jasc",
   "paint-shop-pro",
   "corel"
  ],
  "country": "ca",
  "year": 2004,
  "decade": "2000s",
  "html": "Corel acquires JASC Software, makers of <strong>Paint Shop Pro</strong> and <strong>Animation Shop</strong>."
 },
 {
  "date": "9 Nov 2004",
  "type": "start",
  "tags": [
   "browser"
  ],
  "entities": [
   "firefox",
   "mozilla"
  ],
  "country": "us",
  "year": 2004,
  "decade": "2000s",
  "html": "<strong>Firefox</strong> 1.0 is released."
 },
 {
  "date": "c. 2004–06",
  "type": "milestone",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "boomspeed"
  ],
  "country": "us",
  "year": 2004,
  "decade": "2000s",
  "html": "<strong>Boomspeed</strong> is active as an early image/file host (exact founding and closure dates are lost to time)."
 },
 {
  "date": "Jan 2005",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "bebo"
  ],
  "country": "us",
  "year": 2005,
  "decade": "2000s",
  "html": "Michael and Xochi Birch launch <strong>Bebo</strong>, which becomes especially popular in the UK and Ireland."
 },
 {
  "date": "14 Feb 2005",
  "type": "start",
  "tags": [
   "video-platform"
  ],
  "entities": [
   "youtube"
  ],
  "country": "us",
  "year": 2005,
  "decade": "2000s",
  "html": "<strong>YouTube</strong> is founded (the site launches publicly later that year), rapidly becoming a major user-uploaded video platform."
 },
 {
  "date": "20 Mar 2005",
  "type": "acquisition",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "flickr",
   "yahoo"
  ],
  "country": "ca",
  "year": 2005,
  "decade": "2000s",
  "html": "Yahoo! acquires <strong>Flickr</strong>, bringing the photo-sharing service into its growing Web 2.0 portfolio."
 },
 {
  "date": "18 Apr 2005",
  "type": "acquisition",
  "tags": [
   "program"
  ],
  "entities": [
   "adobe",
   "macromedia",
   "flash"
  ],
  "country": "us",
  "year": 2005,
  "decade": "2000s",
  "html": "Adobe announces its acquisition of <strong>Macromedia</strong> for about $3.4 billion, bringing Flash under Adobe."
 },
 {
  "date": "18 Jul 2005",
  "type": "acquisition",
  "tags": [
   "social-network"
  ],
  "entities": [
   "myspace",
   "news-corp"
  ],
  "country": "us",
  "year": 2005,
  "decade": "2000s",
  "html": "News Corp acquires <strong>MySpace</strong>'s parent company, Intermix Media, for about $580 million."
 },
 {
  "date": "7 Oct 2005",
  "type": "start",
  "tags": [
   "rss"
  ],
  "entities": [
   "google-reader",
   "google"
  ],
  "country": "us",
  "year": 2005,
  "decade": "2000s",
  "html": "<strong>Google Reader</strong> launches, becoming a major hub for following blogs and websites via RSS."
 },
 {
  "date": "2005",
  "type": "start",
  "tags": [
   "social-network",
   "hosting"
  ],
  "entities": [
   "piczo"
  ],
  "country": "us",
  "year": 2005,
  "decade": "2000s",
  "html": "Jim Conning launches <strong>Piczo</strong>, a teen-focused website builder and social network."
 },
 {
  "date": "2005",
  "type": "acquisition",
  "tags": [
   "hosting"
  ],
  "entities": [
   "fortunecity"
  ],
  "country": "gb",
  "year": 2005,
  "decade": "2000s",
  "html": "<strong>FortuneCity</strong> is acquired by Dotster."
 },
 {
  "date": "2006",
  "type": "closure",
  "tags": [
   "program"
  ],
  "entities": [
   "frontpage",
   "microsoft"
  ],
  "country": "us",
  "year": 2006,
  "decade": "2000s",
  "html": "Microsoft discontinues <strong>FrontPage</strong>."
 },
 {
  "date": "June 2006",
  "type": "start",
  "tags": [
   "program"
  ],
  "entities": [
   "blingee",
   "bauer"
  ],
  "country": "us",
  "year": 2006,
  "decade": "2000s",
  "html": "<strong>Blingee</strong> launches as part of the Bauer Teen Network."
 },
 {
  "date": "15 Jul 2006",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "twitter"
  ],
  "country": "us",
  "year": 2006,
  "decade": "2000s",
  "html": "<strong>Twitter</strong> launches publicly, becoming one of the defining social platforms of the Web 2.0 era."
 },
 {
  "date": "9 Oct 2006",
  "type": "acquisition",
  "tags": [
   "video-platform"
  ],
  "entities": [
   "youtube",
   "google"
  ],
  "country": "us",
  "year": 2006,
  "decade": "2000s",
  "html": "Google acquires <strong>YouTube</strong> for $1.65 billion (the deal closes that November)."
 },
 {
  "date": "1 Feb 2007",
  "type": "start",
  "tags": [
   "social-network",
   "fashion"
  ],
  "entities": [
   "polyvore"
  ],
  "country": "us",
  "year": 2007,
  "decade": "2000s",
  "html": "<strong>Polyvore</strong> launches, founded by three former Yahoo! engineers as a social-commerce site where users create fashion, beauty, and interior-design collages called \"sets.\""
 },
 {
  "date": "19 Feb 2007",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "tumblr"
  ],
  "country": "us",
  "year": 2007,
  "decade": "2000s",
  "html": "<strong>Tumblr</strong> launches."
 },
 {
  "date": "2007",
  "type": "start",
  "tags": [
   "social-network",
   "photo-site"
  ],
  "entities": [
   "we-heart-it"
  ],
  "country": "br",
  "year": 2007,
  "decade": "2000s",
  "html": "<strong>We Heart It</strong> is founded by Fabio Giolito, initially as a visual-bookmarking tool before developing into an image-based social network centered on collecting and sharing inspirational imagery."
 },
 {
  "date": "1 Mar 2007",
  "type": "closure",
  "tags": [
   "hosting"
  ],
  "entities": [
   "expage"
  ],
  "country": "us",
  "year": 2007,
  "decade": "2000s",
  "html": "<strong>Expage</strong> shuts down completely."
 },
 {
  "date": "2007",
  "type": "start",
  "tags": [
   "forum"
  ],
  "entities": [
   "zetaboards",
   "zathyus"
  ],
  "country": "us",
  "year": 2007,
  "decade": "2000s",
  "html": "<strong>ZetaBoards</strong> begins public testing as Zathyus Networks' next-generation forum platform, succeeding InvisionFree."
 },
 {
  "date": "Mar 2007",
  "type": "closure",
  "tags": [
   "program"
  ],
  "entities": [
   "adobe",
   "adobe-imageready"
  ],
  "country": "us",
  "year": 2007,
  "decade": "2000s",
  "html": "<strong>Adobe ImageReady</strong> is discontinued, folded into Photoshop CS3."
 },
 {
  "date": "20 Sep 2007",
  "type": "closure",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "yahoo-photos",
   "yahoo",
   "flickr"
  ],
  "country": "us",
  "year": 2007,
  "decade": "2000s",
  "html": "<strong>Yahoo! Photos</strong> shuts down, with Yahoo! directing users to Flickr and other photo services."
 },
 {
  "date": "26 Nov 2007",
  "type": "acquisition",
  "tags": [
   "hosting"
  ],
  "entities": [
   "homestead",
   "intuit"
  ],
  "country": "us",
  "year": 2007,
  "decade": "2000s",
  "html": "Intuit acquires <strong>Homestead</strong>."
 },
 {
  "date": "15 Jan 2008",
  "type": "milestone",
  "tags": [
   "forum"
  ],
  "entities": [
   "ezboard",
   "yuku"
  ],
  "country": "us",
  "year": 2008,
  "decade": "2000s",
  "html": "<strong>ezboard</strong>'s homepage begins redirecting to its successor, <strong>Yuku</strong>, as communities are moved over rather than the service simply closing."
 },
 {
  "date": "2008",
  "type": "acquisition",
  "tags": [
   "social-network"
  ],
  "entities": [
   "bebo",
   "aol"
  ],
  "country": "us",
  "year": 2008,
  "decade": "2000s",
  "html": "AOL buys <strong>Bebo</strong> for $850 million."
 },
 {
  "date": "1 Mar 2008",
  "type": "closure",
  "tags": [
   "browser"
  ],
  "entities": [
   "netscape",
   "aol"
  ],
  "country": "us",
  "year": 2008,
  "decade": "2000s",
  "html": "<strong>AOL</strong> ends development and support for <strong>Netscape</strong>'s browsers."
 },
 {
  "date": "2 Sep 2008",
  "type": "start",
  "tags": [
   "browser"
  ],
  "entities": [
   "chrome",
   "google"
  ],
  "country": "us",
  "year": 2008,
  "decade": "2000s",
  "html": "<strong>Google Chrome</strong> launches."
 },
 {
  "date": "31 Oct 2008",
  "type": "closure",
  "tags": [
   "hosting"
  ],
  "entities": [
   "aol-hometown",
   "aol"
  ],
  "country": "us",
  "year": 2008,
  "decade": "2000s",
  "html": "<strong>AOL Hometown</strong> shuts down."
 },
 {
  "date": "14 Nov 2008",
  "type": "milestone",
  "tags": [
   "hosting"
  ],
  "entities": [
   "freewebs",
   "webs"
  ],
  "country": "us",
  "year": 2008,
  "decade": "2000s",
  "html": "<strong>Freewebs</strong> is renamed <strong>Webs</strong>."
 },
 {
  "date": "2009",
  "type": "start",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "whatsapp",
   "meta"
  ],
  "country": "us",
  "year": 2009,
  "decade": "2000s",
  "html": "<strong>WhatsApp</strong> is founded."
 },
 {
  "date": "May 2009",
  "type": "milestone",
  "tags": [
   "social-network"
  ],
  "entities": [
   "myspace",
   "facebook",
   "meta"
  ],
  "country": "us",
  "year": 2009,
  "decade": "2000s",
  "html": "<strong>MySpace</strong> is overtaken by Facebook in US unique visitors, ending its run as the largest social network."
 },
 {
  "date": "3 Jun 2009",
  "type": "start",
  "tags": [
   "search-engine"
  ],
  "entities": [
   "bing",
   "microsoft"
  ],
  "country": "us",
  "year": 2009,
  "decade": "2000s",
  "html": "<strong>Bing</strong> launches, replacing Microsoft's earlier Live Search."
 },
 {
  "date": "2009",
  "type": "milestone",
  "tags": [
   "hosting"
  ],
  "entities": [
   "tripod"
  ],
  "country": "us",
  "year": 2009,
  "decade": "2000s",
  "html": "<strong>Tripod</strong> stops offering new free webpages, becoming a paid-only service; existing free pages stay online."
 },
 {
  "date": "27 Oct 2009",
  "type": "closure",
  "tags": [
   "hosting"
  ],
  "entities": [
   "geocities",
   "yahoo"
  ],
  "country": "us",
  "year": 2009,
  "decade": "2000s",
  "html": "<strong>GeoCities</strong> (US) shuts down."
 },
 {
  "date": "2010",
  "type": "milestone",
  "tags": [
   "hosting"
  ],
  "entities": [
   "angelfire"
  ],
  "country": "us",
  "year": 2010,
  "decade": "2010s",
  "html": "<strong>Angelfire</strong> undergoes a major redesign and stops creating new classic free sites, though existing free pages stay online for years to come."
 },
 {
  "date": "Mar 2010",
  "type": "start",
  "tags": [
   "photo-site",
   "social-network"
  ],
  "entities": [
   "pinterest"
  ],
  "country": "us",
  "year": 2010,
  "decade": "2010s",
  "html": "<strong>Pinterest</strong> launches, centered around image bookmarking, collections, and visual discovery."
 },
 {
  "date": "6 Oct 2010",
  "type": "start",
  "tags": [
   "social-network",
   "photo-site"
  ],
  "entities": [
   "instagram",
   "meta"
  ],
  "country": "us",
  "year": 2010,
  "decade": "2010s",
  "html": "<strong>Instagram</strong> launches."
 },
 {
  "date": "26 Oct 2010",
  "type": "closure",
  "tags": [
   "file-sharing"
  ],
  "entities": [
   "limewire"
  ],
  "country": "us",
  "year": 2010,
  "decade": "2010s",
  "html": "<strong>LimeWire</strong> is ordered to shut down after a four-year RIAA lawsuit."
 },
 {
  "date": "2010",
  "type": "milestone",
  "tags": [
   "music-art"
  ],
  "entities": [
   "mia",
   "blingee"
  ],
  "country": "gb",
  "year": 2010,
  "decade": "2010s",
  "html": "M.I.A.'s <strong>\"XXXO\"</strong> references the Blingee aesthetic."
 },
 {
  "date": "May 2011",
  "type": "start",
  "tags": [
   "search-engine",
   "cache",
   "archive"
  ],
  "entities": [
   "yahoo-search",
   "yahoo"
  ],
  "country": "us",
  "year": 2011,
  "decade": "2010s",
  "html": "<strong>Yahoo! Search</strong> begins offering its own cached-page links, by way of the search technology it now shares with Microsoft's Bing."
 },
 {
  "date": "2011",
  "type": "milestone",
  "tags": [
   "social-network"
  ],
  "entities": [
   "friendster"
  ],
  "country": "us",
  "year": 2011,
  "decade": "2010s",
  "html": "<strong>Friendster</strong> relaunches as a social-gaming site, dropping its original social-networking features."
 },
 {
  "date": "10 May 2011",
  "type": "acquisition",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "skype",
   "microsoft"
  ],
  "country": "us",
  "year": 2011,
  "decade": "2010s",
  "html": "Microsoft announces its acquisition of <strong>Skype</strong> for $8.5 billion."
 },
 {
  "date": "29 Jun 2011",
  "type": "acquisition",
  "tags": [
   "social-network"
  ],
  "entities": [
   "myspace",
   "specific-media"
  ],
  "country": "us",
  "year": 2011,
  "decade": "2010s",
  "html": "Specific Media, with Justin Timberlake as co-owner, buys <strong>MySpace</strong> from News Corp for $35 million and relaunches it."
 },
 {
  "date": "Sep 2011",
  "type": "acquisition",
  "tags": [
   "forum"
  ],
  "entities": [
   "yuku",
   "crowdgather"
  ],
  "country": "us",
  "year": 2011,
  "decade": "2010s",
  "html": "CrowdGather acquires <strong>Yuku</strong> and the legacy ezboard domains, after earlier ownership stints under KickApps and Inform Technologies."
 },
 {
  "date": "Sep 2011",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "snapchat"
  ],
  "country": "us",
  "year": 2011,
  "decade": "2010s",
  "html": "<strong>Snapchat</strong> launches, relaunched from the earlier Picaboo app."
 },
 {
  "date": "28 Dec 2011",
  "type": "acquisition",
  "tags": [
   "hosting"
  ],
  "entities": [
   "webs",
   "vistaprint"
  ],
  "country": "us",
  "year": 2011,
  "decade": "2010s",
  "html": "Vistaprint acquires <strong>Webs</strong> for roughly $117.5 million."
 },
 {
  "date": "30 Apr 2012",
  "type": "closure",
  "tags": [
   "hosting"
  ],
  "entities": [
   "fortunecity"
  ],
  "country": "gb",
  "year": 2012,
  "decade": "2010s",
  "html": "<strong>FortuneCity</strong> ends its free web-hosting service, citing rising costs that made it financially unsustainable, and directs users toward paid hosting — taking another GeoCities-era personal-hosting platform offline."
 },
 {
  "date": "Nov 2012",
  "type": "closure",
  "tags": [
   "social-network",
   "hosting"
  ],
  "entities": [
   "piczo"
  ],
  "country": "us",
  "year": 2012,
  "decade": "2010s",
  "html": "<strong>Piczo</strong> shuts down after two acquisitions."
 },
 {
  "date": "24 Jan 2013",
  "type": "start",
  "tags": [
   "video-platform"
  ],
  "entities": [
   "vine",
   "twitter"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "<strong>Vine</strong> launches, popularizing 6-second looping videos."
 },
 {
  "date": "Feb 2013",
  "type": "start",
  "tags": [
   "gif-platform"
  ],
  "entities": [
   "giphy"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "<strong>GIPHY</strong> is founded."
 },
 {
  "date": "15 Mar 2013",
  "type": "closure",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "msn-messenger",
   "microsoft"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "Microsoft shuts down <strong>MSN/Windows Live Messenger</strong> worldwide outside China, pushing users to Skype."
 },
 {
  "date": "6 May 2013",
  "type": "milestone",
  "tags": [
   "program"
  ],
  "entities": [
   "adobe",
   "photoshop",
   "creative-cloud"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "Adobe announces <strong>Creative Cloud</strong> will become its only option going forward, ending perpetual-license sales of Photoshop and the rest of Creative Suite."
 },
 {
  "date": "20 May 2013",
  "type": "acquisition",
  "tags": [
   "social-network"
  ],
  "entities": [
   "tumblr",
   "yahoo"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "Yahoo! announces its acquisition of <strong>Tumblr</strong> for approximately $1.1 billion."
 },
 {
  "date": "28 Jun 2013",
  "type": "start",
  "tags": [
   "hosting"
  ],
  "entities": [
   "neocities"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "<strong>Neocities</strong> launches."
 },
 {
  "date": "1 Jul 2013",
  "type": "closure",
  "tags": [
   "rss"
  ],
  "entities": [
   "google-reader",
   "google"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "Google shuts down <strong>Google Reader</strong>."
 },
 {
  "date": "8 Jul 2013",
  "type": "closure",
  "tags": [
   "search-engine"
  ],
  "entities": [
   "altavista",
   "yahoo"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "Yahoo! shuts down <strong>AltaVista</strong>."
 },
 {
  "date": "7 Aug 2013",
  "type": "closure",
  "tags": [
   "social-network"
  ],
  "entities": [
   "bebo",
   "aol"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "Bebo's founders buy it back from AOL for $1 million and shut it down immediately after."
 },
 {
  "date": "30 Sep 2013",
  "type": "closure",
  "tags": [
   "isp"
  ],
  "entities": [
   "webtv",
   "microsoft"
  ],
  "country": "us",
  "year": 2013,
  "decade": "2010s",
  "html": "Microsoft shuts down <strong>WebTV</strong>, renamed MSN TV in July 2001, ending the service."
 },
 {
  "date": "19 Feb 2014",
  "type": "acquisition",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "whatsapp",
   "facebook",
   "meta"
  ],
  "country": "us",
  "year": 2014,
  "decade": "2010s",
  "html": "<strong>Facebook</strong> announces its acquisition of <strong>WhatsApp</strong> for about $19 billion (the deal closes that October)."
 },
 {
  "date": "2014",
  "type": "milestone",
  "tags": [
   "social-network"
  ],
  "entities": [
   "bebo"
  ],
  "country": "us",
  "year": 2014,
  "decade": "2010s",
  "html": "<strong>Bebo</strong> relaunches as a messaging app, the first of several product pivots (through streaming and esports) over the next few years."
 },
 {
  "date": "2014",
  "type": "start",
  "tags": [
   "gif-platform"
  ],
  "entities": [
   "tenor"
  ],
  "country": "us",
  "year": 2014,
  "decade": "2010s",
  "html": "<strong>Tenor</strong> is founded."
 },
 {
  "date": "2014",
  "type": "closure",
  "tags": [
   "hosting"
  ],
  "entities": [
   "homestead",
   "intuit"
  ],
  "country": "us",
  "year": 2014,
  "decade": "2010s",
  "html": "<strong>Homestead</strong> is formally discontinued."
 },
 {
  "date": "Sep 2014",
  "type": "closure",
  "tags": [
   "social-network"
  ],
  "entities": [
   "orkut",
   "google"
  ],
  "country": "us",
  "year": 2014,
  "decade": "2010s",
  "html": "Google shuts down <strong>Orkut</strong>."
 },
 {
  "date": "2015",
  "type": "closure",
  "tags": [
   "social-network"
  ],
  "entities": [
   "friendster"
  ],
  "country": "us",
  "year": 2015,
  "decade": "2010s",
  "html": "<strong>Friendster</strong> shuts down for good."
 },
 {
  "date": "29 Jul 2015",
  "type": "start",
  "tags": [
   "browser"
  ],
  "entities": [
   "edge",
   "microsoft",
   "internet-explorer"
  ],
  "country": "us",
  "year": 2015,
  "decade": "2010s",
  "html": "<strong>Microsoft Edge</strong> launches alongside Windows 10, positioned to replace Internet Explorer as Microsoft's default browser."
 },
 {
  "date": "31 Jul 2015",
  "type": "acquisition",
  "tags": [
   "social-network",
   "fashion"
  ],
  "entities": [
   "polyvore",
   "yahoo"
  ],
  "country": "us",
  "year": 2015,
  "decade": "2010s",
  "html": "Yahoo! announces its acquisition of <strong>Polyvore</strong> for a reported $200 million or more; Polyvore continues operating normally under Yahoo."
 },
 {
  "date": "Aug 2015",
  "type": "milestone",
  "tags": [
   "program"
  ],
  "entities": [
   "blingee"
  ],
  "country": "us",
  "year": 2015,
  "decade": "2010s",
  "html": "<strong>Blingee</strong>'s near-shutdown is averted by user outcry and emergency funding."
 },
 {
  "date": "2016",
  "type": "acquisition",
  "tags": [
   "forum"
  ],
  "entities": [
   "yuku",
   "tapatalk"
  ],
  "country": "us",
  "year": 2016,
  "decade": "2010s",
  "html": "Tapatalk acquires <strong>Yuku</strong>."
 },
 {
  "date": "Oct 2016",
  "type": "start",
  "tags": [
   "gif-platform"
  ],
  "entities": [
   "gifcities",
   "internet-archive",
   "geocities"
  ],
  "country": "us",
  "year": 2016,
  "decade": "2010s",
  "html": "The Internet Archive launches <strong>GifCities</strong>, for its own 20th anniversary."
 },
 {
  "date": "27 Oct 2016",
  "type": "milestone",
  "tags": [
   "video-platform"
  ],
  "entities": [
   "vine",
   "twitter"
  ],
  "country": "us",
  "year": 2016,
  "decade": "2010s",
  "html": "Twitter announces it's discontinuing <strong>Vine</strong>, disabling new uploads while leaving viewing and downloads active."
 },
 {
  "date": "17 Jan 2017",
  "type": "closure",
  "tags": [
   "video-platform"
  ],
  "entities": [
   "vine",
   "twitter"
  ],
  "country": "us",
  "year": 2017,
  "decade": "2010s",
  "html": "Twitter officially shuts down <strong>Vine</strong>; the app's remaining functionality is discontinued a few months later."
 },
 {
  "date": "20 Jan 2017",
  "type": "start",
  "tags": [
   "video-platform",
   "archive"
  ],
  "entities": [
   "vine",
   "twitter"
  ],
  "country": "us",
  "year": 2017,
  "decade": "2010s",
  "html": "Twitter launches an online archive of every <strong>Vine</strong> video ever published."
 },
 {
  "date": "2017",
  "type": "acquisition",
  "tags": [
   "forum"
  ],
  "entities": [
   "zathyus",
   "tapatalk",
   "invisionfree",
   "zetaboards"
  ],
  "country": "us",
  "year": 2017,
  "decade": "2010s",
  "html": "Tapatalk acquires Zathyus Networks, bringing <strong>InvisionFree</strong> and <strong>ZetaBoards</strong> under its umbrella."
 },
 {
  "date": "2017",
  "type": "closure",
  "tags": [
   "forum"
  ],
  "entities": [
   "yuku",
   "tapatalk"
  ],
  "country": "us",
  "year": 2017,
  "decade": "2010s",
  "html": "Tapatalk migrates <strong>Yuku</strong>'s forums onto its own platform, ending Yuku as a standalone service."
 },
 {
  "date": "2017",
  "type": "acquisition",
  "tags": [
   "social-network"
  ],
  "entities": [
   "yahoo",
   "verizon",
   "oath",
   "tumblr",
   "polyvore"
  ],
  "country": "us",
  "year": 2017,
  "decade": "2010s",
  "html": "Verizon completes its acquisition of Yahoo!'s operating business, placing <strong>Tumblr</strong> and <strong>Polyvore</strong> under the new Oath subsidiary."
 },
 {
  "date": "2017",
  "type": "closure",
  "tags": [
   "bookmarking"
  ],
  "entities": [
   "delicious"
  ],
  "country": "us",
  "year": 2017,
  "decade": "2010s",
  "html": "<strong>Delicious</strong> effectively shuts down after several ownership changes."
 },
 {
  "date": "28 Jun 2017",
  "type": "milestone",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "photobucket"
  ],
  "country": "us",
  "year": 2017,
  "decade": "2010s",
  "html": "<strong>Photobucket</strong> disables free hotlinking, breaking embedded images across the web unless users pay."
 },
 {
  "date": "15 Dec 2017",
  "type": "closure",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "aim",
   "aol"
  ],
  "country": "us",
  "year": 2017,
  "decade": "2010s",
  "html": "<strong>AOL Instant Messenger (AIM)</strong> shuts down after 20 years."
 },
 {
  "date": "2018",
  "type": "closure",
  "tags": [
   "forum"
  ],
  "entities": [
   "invisionfree",
   "zetaboards",
   "tapatalk"
  ],
  "country": "us",
  "year": 2018,
  "decade": "2010s",
  "html": "<strong>InvisionFree</strong> and <strong>ZetaBoards</strong> are wound down as their communities are migrated to Tapatalk Groups."
 },
 {
  "date": "27 Mar 2018",
  "type": "acquisition",
  "tags": [
   "gif-platform"
  ],
  "entities": [
   "tenor",
   "google"
  ],
  "country": "us",
  "year": 2018,
  "decade": "2010s",
  "html": "Google acquires <strong>Tenor</strong>."
 },
 {
  "date": "5 Apr 2018",
  "type": "closure",
  "tags": [
   "social-network",
   "fashion"
  ],
  "entities": [
   "polyvore",
   "ssense",
   "oath"
  ],
  "country": "ca",
  "year": 2018,
  "decade": "2010s",
  "html": "SSENSE acquires <strong>Polyvore</strong> from Oath and shuts it down immediately, redirecting the site to SSENSE — a notorious loss of user-created web content."
 },
 {
  "date": "Apr 2018",
  "type": "closure",
  "tags": [
   "video-platform",
   "archive"
  ],
  "entities": [
   "vine",
   "twitter"
  ],
  "country": "us",
  "year": 2018,
  "decade": "2010s",
  "html": "The <strong>Vine</strong> archive is officially discontinued."
 },
 {
  "date": "17 Jul 2018",
  "type": "closure",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "yahoo-messenger",
   "yahoo"
  ],
  "country": "us",
  "year": 2018,
  "decade": "2010s",
  "html": "<strong>Yahoo! Messenger</strong> shuts down."
 },
 {
  "date": "31 Mar 2019",
  "type": "closure",
  "tags": [
   "hosting"
  ],
  "entities": [
   "geocities-japan",
   "yahoo-japan"
  ],
  "country": "jp",
  "year": 2019,
  "decade": "2010s",
  "html": "<strong>GeoCities Japan</strong> shuts down, nearly a decade after its American counterpart."
 },
 {
  "date": "18 Mar 2019",
  "type": "milestone",
  "tags": [
   "social-network"
  ],
  "entities": [
   "myspace"
  ],
  "country": "us",
  "year": 2019,
  "decade": "2010s",
  "html": "<strong>MySpace</strong> confirms a botched server migration permanently deleted 12 years of user content (2003–2015): over 50 million tracks from roughly 14 million artists, plus millions of personal photos and videos, early blog posts, comments, and private messages."
 },
 {
  "date": "18 Jun 2019",
  "type": "acquisition",
  "tags": [
   "social-network"
  ],
  "entities": [
   "bebo"
  ],
  "country": "us",
  "year": 2019,
  "decade": "2010s",
  "html": "Twitch acquires <strong>Bebo</strong> for up to $25 million to bolster its esports efforts."
 },
 {
  "date": "12 Aug 2019",
  "type": "acquisition",
  "tags": [
   "social-network"
  ],
  "entities": [
   "tumblr",
   "automattic",
   "verizon"
  ],
  "country": "us",
  "year": 2019,
  "decade": "2010s",
  "html": "Automattic acquires <strong>Tumblr</strong> from Verizon."
 },
 {
  "date": "16 Sep 2019",
  "type": "closure",
  "tags": [
   "photo-site"
  ],
  "entities": [
   "tinypic",
   "photobucket"
  ],
  "country": "us",
  "year": 2019,
  "decade": "2010s",
  "html": "<strong>TinyPic</strong> shuts down, redirecting users to Photobucket."
 },
 {
  "date": "May 2020",
  "type": "acquisition",
  "tags": [
   "gif-platform"
  ],
  "entities": [
   "giphy",
   "meta",
   "facebook"
  ],
  "country": "us",
  "year": 2020,
  "decade": "2020s",
  "html": "Meta acquires <strong>GIPHY</strong>."
 },
 {
  "date": "15 Dec 2020",
  "type": "closure",
  "tags": [
   "social-network"
  ],
  "entities": [
   "yahoo-groups",
   "yahoo"
  ],
  "country": "us",
  "year": 2020,
  "decade": "2020s",
  "html": "<strong>Yahoo! Groups</strong> shuts down, deleting its archives."
 },
 {
  "date": "31 Dec 2020",
  "type": "closure",
  "tags": [
   "program"
  ],
  "entities": [
   "adobe",
   "flash"
  ],
  "country": "us",
  "year": 2020,
  "decade": "2020s",
  "html": "Adobe ends support for <strong>Flash Player</strong>."
 },
 {
  "date": "2021",
  "type": "start",
  "tags": [
   "gif-platform"
  ],
  "entities": [
   "klipy"
  ],
  "country": "ge",
  "year": 2021,
  "decade": "2020s",
  "html": "<strong>Klipy</strong> is founded."
 },
 {
  "date": "2021",
  "type": "acquisition",
  "tags": [
   "file-sharing"
  ],
  "entities": [
   "limewire"
  ],
  "country": "at",
  "year": 2021,
  "decade": "2020s",
  "html": "Austrian brothers Julian and Paul Zehetmayr acquire the <strong>LimeWire</strong> brand and its assets."
 },
 {
  "date": "2021",
  "type": "milestone",
  "tags": [
   "social-network"
  ],
  "entities": [
   "we-heart-it"
  ],
  "country": "br",
  "year": 2021,
  "decade": "2020s",
  "html": "<strong>We Heart It</strong> removes several social features, including articles, messages, and some community functionality, as the platform changes direction."
 },
 {
  "date": "29 Jan 2021",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "bebo"
  ],
  "country": "us",
  "year": 2021,
  "decade": "2020s",
  "html": "A private-beta revival of <strong>Bebo</strong> is announced."
 },
 {
  "date": "7 Oct 2021",
  "type": "acquisition",
  "tags": [
   "forum"
  ],
  "entities": [
   "proboards",
   "verticalscope"
  ],
  "country": "us",
  "year": 2021,
  "decade": "2020s",
  "html": "VerticalScope acquires <strong>ProBoards</strong>' assets for $4.2 million; the service continues operating."
 },
 {
  "date": "28 Oct 2021",
  "type": "milestone",
  "tags": [
   "social-network"
  ],
  "entities": [
   "facebook",
   "meta"
  ],
  "country": "us",
  "year": 2021,
  "decade": "2020s",
  "html": "<strong>Facebook</strong> rebrands its parent company as <strong>Meta</strong>."
 },
 {
  "date": "May 2022",
  "type": "closure",
  "tags": [
   "social-network"
  ],
  "entities": [
   "bebo"
  ],
  "country": "us",
  "year": 2022,
  "decade": "2020s",
  "html": "The private-beta <strong>Bebo</strong> revival shuts down."
 },
 {
  "date": "14 Mar 2022",
  "type": "milestone",
  "tags": [
   "person"
  ],
  "entities": [
   "gif",
   "steve-wilhite"
  ],
  "country": "us",
  "year": 2022,
  "decade": "2020s",
  "html": "Steve Wilhite, engineering lead on the <strong>GIF</strong> format, passes away."
 },
 {
  "date": "9 May 2022",
  "type": "start",
  "tags": [
   "file-sharing"
  ],
  "entities": [
   "limewire"
  ],
  "country": "at",
  "year": 2022,
  "decade": "2020s",
  "html": "<strong>LimeWire</strong> relaunches, more than a decade after shutting down, as an NFT marketplace."
 },
 {
  "date": "15 Jun 2022",
  "type": "closure",
  "tags": [
   "browser"
  ],
  "entities": [
   "internet-explorer",
   "microsoft",
   "edge"
  ],
  "country": "us",
  "year": 2022,
  "decade": "2020s",
  "html": "<strong>Internet Explorer</strong> is officially retired, with Microsoft directing users to Edge."
 },
 {
  "date": "27 Oct 2022",
  "type": "acquisition",
  "tags": [
   "social-network"
  ],
  "entities": [
   "twitter",
   "elon-musk"
  ],
  "country": "us",
  "year": 2022,
  "decade": "2020s",
  "html": "Elon Musk completes his acquisition of <strong>Twitter</strong> for $44 billion."
 },
 {
  "date": "23 May 2023",
  "type": "acquisition",
  "tags": [
   "gif-platform"
  ],
  "entities": [
   "giphy",
   "meta",
   "shutterstock"
  ],
  "country": "us",
  "year": 2023,
  "decade": "2020s",
  "html": "Shutterstock acquires <strong>GIPHY</strong> from Meta, after UK regulators force a divestiture."
 },
 {
  "date": "23 Jul 2023",
  "type": "closure",
  "tags": [
   "social-network"
  ],
  "entities": [
   "twitter",
   "x",
   "elon-musk"
  ],
  "country": "us",
  "year": 2023,
  "decade": "2020s",
  "html": "Musk rebrands <strong>Twitter</strong> as <strong>X</strong>, retiring the bird logo."
 },
 {
  "date": "2023",
  "type": "closure",
  "tags": [
   "hosting"
  ],
  "entities": [
   "webs",
   "vistaprint"
  ],
  "country": "us",
  "year": 2023,
  "decade": "2020s",
  "html": "<strong>Webs</strong> shuts down."
 },
 {
  "date": "2023",
  "type": "closure",
  "tags": [
   "social-network"
  ],
  "entities": [
   "we-heart-it"
  ],
  "country": "br",
  "year": 2023,
  "decade": "2020s",
  "html": "<strong>We Heart It</strong> effectively ends its original social-image platform, shifting toward a mobile photo-editing app model."
 },
 {
  "date": "2 Feb 2024",
  "type": "closure",
  "tags": [
   "search-engine",
   "cache",
   "archive"
  ],
  "entities": [
   "google"
  ],
  "country": "us",
  "year": 2024,
  "decade": "2020s",
  "html": "<strong>Google</strong> retires its \"Cached\" page feature, citing improved page reliability across the modern web."
 },
 {
  "date": "22 Feb 2024",
  "type": "closure",
  "tags": [
   "forum"
  ],
  "entities": [
   "google-groups",
   "google",
   "usenet"
  ],
  "country": "us",
  "year": 2024,
  "decade": "2020s",
  "html": "<strong>Google Groups</strong> stops supporting posting or viewing new Usenet content; existing archives remain available."
 },
 {
  "date": "26 Jun 2024",
  "type": "closure",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "icq"
  ],
  "country": "il",
  "year": 2024,
  "decade": "2020s",
  "html": "<strong>ICQ</strong> shuts down after nearly 28 years."
 },
 {
  "date": "June 2024",
  "type": "closure",
  "tags": [
   "program"
  ],
  "entities": [
   "blingee"
  ],
  "country": "us",
  "year": 2024,
  "decade": "2020s",
  "html": "<strong>Blingee</strong> closes permanently."
 },
 {
  "date": "Sep 2024",
  "type": "milestone",
  "tags": [
   "search-engine",
   "cache",
   "archive"
  ],
  "entities": [
   "google",
   "internet-archive",
   "wayback-machine"
  ],
  "country": "us",
  "year": 2024,
  "decade": "2020s",
  "html": "Google and the <strong>Internet Archive</strong> announce a collaboration linking to the Wayback Machine directly from Google Search results."
 },
 {
  "date": "11 Dec 2024",
  "type": "closure",
  "tags": [
   "search-engine",
   "cache",
   "archive"
  ],
  "entities": [
   "bing",
   "microsoft"
  ],
  "country": "us",
  "year": 2024,
  "decade": "2020s",
  "html": "<strong>Bing</strong> retires its web-caching feature, following Google's lead."
 },
 {
  "date": "late 2024",
  "type": "closure",
  "tags": [
   "search-engine",
   "cache",
   "archive"
  ],
  "entities": [
   "yahoo-search",
   "yahoo",
   "bing",
   "microsoft"
  ],
  "country": "us",
  "year": 2024,
  "decade": "2020s",
  "html": "<strong>Yahoo! Search</strong>'s cache links quietly stop working as its Bing-powered backend loses the feature, with no official announcement."
 },
 {
  "date": "5 May 2025",
  "type": "closure",
  "tags": [
   "messaging-app"
  ],
  "entities": [
   "skype",
   "microsoft"
  ],
  "country": "us",
  "year": 2025,
  "decade": "2020s",
  "html": "Microsoft retires <strong>Skype</strong> after 22 years, shifting users to Teams."
 },
 {
  "date": "30 Sep 2025",
  "type": "closure",
  "tags": [
   "isp"
  ],
  "entities": [
   "aol"
  ],
  "country": "us",
  "year": 2025,
  "decade": "2020s",
  "html": "<strong>AOL</strong> shuts down its dial-up internet service after 34 years."
 },
 {
  "date": "2026",
  "type": "milestone",
  "tags": [
   "social-network",
   "hosting"
  ],
  "entities": [
   "piczo"
  ],
  "country": "us",
  "year": 2026,
  "decade": "2020s",
  "html": "A new <strong>Piczo</strong> pre-launch site appears, teasing a possible revival."
 },
 {
  "date": "Jan 2026",
  "type": "milestone",
  "tags": [
   "hosting"
  ],
  "entities": [
   "angelfire"
  ],
  "country": "us",
  "year": 2026,
  "decade": "2020s",
  "html": "A major outage leaves <strong>Angelfire</strong>'s user-hosted sites inaccessible."
 },
 {
  "date": "6 Mar 2026",
  "type": "milestone",
  "tags": [
   "hosting"
  ],
  "entities": [
   "angelfire",
   "tripod",
   "lycos"
  ],
  "country": "us",
  "year": 2026,
  "decade": "2020s",
  "html": "<strong>Lycos</strong> announces the final closure of both <strong>Angelfire</strong> and <strong>Tripod</strong>."
 },
 {
  "date": "24 Apr 2026",
  "type": "closure",
  "tags": [
   "hosting"
  ],
  "entities": [
   "angelfire",
   "tripod",
   "lycos"
  ],
  "country": "us",
  "year": 2026,
  "decade": "2020s",
  "html": "<strong>Angelfire</strong> and <strong>Tripod</strong> shut down for good under Lycos."
 },
 {
  "date": "30 Jun 2026",
  "type": "closure",
  "tags": [
   "gif-platform"
  ],
  "entities": [
   "tenor",
   "google"
  ],
  "country": "us",
  "year": 2026,
  "decade": "2020s",
  "html": "Google deprecates <strong>Tenor</strong>'s public API."
 },
 {
  "date": "2026",
  "type": "start",
  "tags": [
   "social-network"
  ],
  "entities": [
   "bebo"
  ],
  "country": "us",
  "year": 2026,
  "decade": "2020s",
  "html": "<strong>Bebo</strong> returns again."
 },
 {
  "date": "1 Sep 2026",
  "type": "closure",
  "tags": [
   "social-network"
  ],
  "entities": [
   "bebo"
  ],
  "country": "us",
  "year": 2026,
  "decade": "2020s",
  "html": "<strong>Bebo</strong> closes."
 }
];
