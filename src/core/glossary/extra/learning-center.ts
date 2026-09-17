import type { GlossaryTerm } from '../terms';

/**
 * Terms the Learning Center adds to the glossary. Only that module's pass edits this file, which
 * is what lets ten module passes add words in parallel without conflicting
 * (docs/implementation/uiux.md §7.6). Same writing rules as `../terms.ts`.
 *
 * These are the everyday words the First steps track leans on before any protocol is
 * named: a reader who has never heard "server" or "browser" needs them tappable too.
 * They are written in the plain voice, and any analogy is one from the shared table in
 * `docs/CONTENT-STYLE.md`.
 */
export const EXTRA_TERMS: readonly GlossaryTerm[] = [
  {
    id: 'network',
    term: 'network',
    aliases: ['networks'],
    short: 'Two or more devices joined together so they can send each other messages.',
    definition:
      'A network can be as small as a laptop and a phone sharing one home router, or as large as a company with thousands of machines. What makes it a network is that every device on it can reach the others, and they agree on how to talk.',
    modules: ['network-map'],
    lessons: ['your-devices-are-on-a-network'],
  },
  {
    id: 'internet',
    term: 'internet',
    aliases: ['the internet'],
    short:
      'The worldwide network of networks: millions of separate networks joined together.',
    definition:
      'Nobody owns the internet as a whole. Homes, schools, companies and internet providers each run their own network, and routers pass messages between them. A message to a website usually crosses several of these networks on the way.',
    modules: ['network-map', 'packet-journey'],
    lessons: ['what-happens-when-you-open-a-website', 'your-devices-are-on-a-network'],
  },
  {
    id: 'server',
    term: 'server',
    aliases: ['servers', 'web server', 'web servers'],
    short:
      'A computer that waits for requests and answers them, such as the one that holds a website.',
    definition:
      'A server is an ordinary computer whose job is to answer. A website lives on one or more servers, and your browser asks them for each page. Other servers answer other questions, such as which number a website name belongs to.',
    modules: ['internet-simulator', 'http-explorer'],
    lessons: ['what-happens-when-you-open-a-website', 'asking-for-the-page'],
  },
  {
    id: 'browser',
    term: 'browser',
    aliases: ['browsers', 'web browser', 'web browsers'],
    short: 'The app you use to open websites, such as Chrome, Firefox, Safari or Edge.',
    definition:
      'A browser turns a web address into a page on your screen. To do that it looks up where the site is, connects to its server, asks for the page, and then draws what comes back, often asking for more files along the way.',
    modules: ['internet-simulator', 'http-explorer'],
    lessons: ['what-happens-when-you-open-a-website', 'asking-for-the-page'],
  },
  {
    id: 'web-address',
    term: 'web address',
    aliases: ['web addresses'],
    short:
      'What you type to open a website, such as https://www.example.com/. Its technical name is URL.',
    definition:
      'A web address says three things: how to talk to the site (https), which site it is (the domain name, such as www.example.com), and which page on that site you want (the part after the name). URL stands for Uniform Resource Locator.',
    modules: ['internet-simulator', 'http-explorer'],
    lessons: ['what-happens-when-you-open-a-website'],
  },
  {
    id: 'domain-name',
    term: 'domain name',
    aliases: ['domain names', 'hostname', 'hostnames'],
    short:
      'The name part of a web address, such as www.example.com, which people can remember.',
    definition:
      'A domain name is for people. Computers need a number, an IP address, before they can send anything, so a visit to a named site starts with a lookup that turns the name into that number. DNS is the system that does it.',
    modules: ['dns-explorer', 'internet-simulator'],
    lessons: ['finding-a-websites-address'],
  },
  {
    id: 'wi-fi',
    term: 'Wi-Fi',
    aliases: ['WiFi', 'wireless network'],
    short: 'A way to join a network by radio instead of by cable.',
    definition:
      'Wi-Fi carries the same messages a cable would, over radio. Devices on one Wi-Fi channel take turns to send, which is why a wireless link is usually slower than a cable into the same router.',
    modules: ['network-map'],
    lessons: ['your-devices-are-on-a-network'],
  },
  {
    id: 'access-point',
    term: 'access point',
    aliases: ['access points', 'Wi-Fi access point'],
    short:
      'The box that sends and receives Wi-Fi, so wireless devices can join the wired network.',
    definition:
      'An access point connects radio to cable. It passes messages between wireless devices and the rest of the network without deciding where they go next. In many homes it is built into the same box as the router.',
    modules: ['network-map'],
    lessons: ['your-devices-are-on-a-network'],
  },
  {
    id: 'switch',
    term: 'switch',
    aliases: ['switches', 'network switch'],
    short:
      'A box that passes messages between the devices plugged into it, inside one network.',
    definition:
      'A switch works like a building’s internal mail room: it delivers between the devices on one network. It never sends anything on to another network. That is a router’s job.',
    modules: ['network-map'],
    lessons: ['your-devices-are-on-a-network'],
  },
  {
    id: 'internet-service-provider',
    term: 'internet service provider',
    aliases: ['internet provider', 'internet providers'],
    short: 'The company that connects your home or phone to the rest of the internet.',
    definition:
      'Your home router sends everything meant for the internet to your internet service provider, usually shortened to ISP. The ISP’s routers pass it on toward the network it is addressed to, often through other providers on the way.',
    modules: ['network-map', 'packet-journey'],
    lessons: ['your-devices-are-on-a-network', 'messages-travel-in-packets'],
  },
  {
    id: 'http-request',
    term: 'HTTP request',
    aliases: ['request', 'requests', 'HTTP requests'],
    short:
      'The message a browser sends to a server to ask for something, such as a page.',
    definition:
      'A request works like a written order. It names what is wanted, with a method such as GET and a path such as /index.html, and adds notes called headers, such as which site it is for. The server sends back a response.',
    modules: ['http-explorer', 'internet-simulator'],
    lessons: ['asking-for-the-page'],
  },
  {
    id: 'http-response',
    term: 'HTTP response',
    aliases: ['response', 'responses', 'HTTP responses'],
    short:
      'The message a server sends back to answer a request, starting with a status code.',
    definition:
      'A response works like the reply to a written order. It opens with a status code that says how it went, adds headers that describe what follows, and then carries the thing that was asked for, such as the page itself.',
    modules: ['http-explorer', 'internet-simulator'],
    lessons: ['asking-for-the-page'],
  },
  {
    id: 'https',
    term: 'HTTPS',
    aliases: ['Hypertext Transfer Protocol Secure'],
    short:
      'HTTP sent inside an encrypted connection, so only your browser and the website can read it.',
    definition:
      'HTTPS is the same HTTP requests and responses, carried inside TLS. The browser checks the site’s certificate before it sends anything, and everything after that is encrypted. The padlock beside the web address means the page came over HTTPS.',
    modules: ['https-explorer', 'internet-simulator'],
    lessons: ['keeping-it-private', 'what-happens-when-you-open-a-website'],
  },
  {
    id: 'encryption',
    term: 'encryption',
    aliases: ['encrypted', 'encrypt', 'encrypts', 'encrypting'],
    short:
      'Scrambling a message so that only someone holding the right secret can read it.',
    definition:
      'Encrypted data still crosses every network in between, and anyone on the way can copy it. What they copy is unreadable without the secret, which only the two ends hold. It is what keeps passwords and messages private over HTTPS.',
    modules: ['https-explorer'],
    lessons: ['keeping-it-private'],
  },
];
