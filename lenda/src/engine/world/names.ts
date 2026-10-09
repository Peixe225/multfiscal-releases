/**
 * Pools de nomes fictícios por nacionalidade — novas gerações (regens) e artilheiros sintéticos.
 * Nomes plausíveis, combinados ao acaso (nome + sobrenome), nunca jogadores reais específicos.
 */
import type { Rng } from '../rng'

interface Pool {
  first: string[]
  last: string[]
  /** Probabilidade de o nome curto ser o primeiro nome/apelido (estilo brasileiro). */
  firstNameShort?: number
}

/** Partículas que abrem um sobrenome composto ("de Jong", "van den Berg", "De Luca", "El Amrani"). */
const PARTICLES = new Set(['de', 'De', 'van', 'Van', 'den', 'der', 'El', 'da', 'dos', 'del', 'Del', 'di', 'Di'])

/** Lista separada por espaços; a partícula fica grudada na palavra seguinte ("van den Berg" é um nome só). */
function words(list: string): string[] {
  const out: string[] = []
  let pre = ''
  for (const w of list.split(' ')) {
    if (PARTICLES.has(w)) pre += `${w} `
    else {
      out.push(pre + w)
      pre = ''
    }
  }
  return out
}

const P = (first: string, last: string, firstNameShort = 0): Pool => ({
  first: words(first),
  last: words(last),
  firstNameShort,
})

const POOLS: Record<string, Pool> = {
  BRA: P(
    'Gabriel Lucas Matheus Pedro Guilherme Rafael Vinícius Kauã Davi Arthur João Enzo Caio Igor Renan Wesley Luan Yuri Breno Kaio Vitinho Luizinho Juninho Felipinho Otávio Heitor Samuel Erick Leandrinho Diguinho',
    'Silva Santos Oliveira Souza Lima Pereira Costa Ferreira Rodrigues Almeida Nascimento Carvalho Gomes Ribeiro Martins Araújo Barbosa Rocha Dias Moreira Cardoso Teixeira Correia Mendes Freitas Monteiro Batista Farias Pires Cavalcanti',
    0.4,
  ),
  ARG: P(
    'Santiago Mateo Thiago Valentín Franco Nicanor Facundo Agustín Joaquín Tomás Gonzalo Ezequiel Matías Lucas Bautista Máximo Ignacio Benjamín Alexis Leandro Lisandro Ramiro Bruno Iván',
    'González Rodríguez Fernández López Martínez Díaz Pérez Romero Sosa Álvarez Acosta Benítez Herrera Suárez Aguirre Giménez Molina Ríos Ledesma Villalba Correa Ojeda Figueroa Ponce Quiroga',
  ),
  ESP: P(
    'Pablo Hugo Álvaro Daniel Alejandro Adrián Javier Marc Pau Iker Unai Mikel Pedro Diego Jon Aitor Ander Carlos Jorge Rubén Asier Óscar Mario Víctor',
    'García Fernández González Rodríguez López Martínez Sánchez Pérez Gómez Martín Jiménez Ruiz Hernández Díaz Moreno Muñoz Álvarez Romero Navarro Domínguez Gil Serrano Blanco Castro Ortega Delgado',
  ),
  POR: P(
    'João Rodrigo Tiago Francisco Gonçalo Rafael Duarte Tomás Rúben Pedro Renato Ricardo Hugo Miguel Vasco Luís Henrique Salvador Guilherme Simão',
    'Silva Santos Ferreira Pereira Oliveira Costa Rodrigues Martins Sousa Fernandes Gomes Lopes Marques Alves Almeida Ribeiro Pinto Carvalho Teixeira Moreira Correia Machado Cunha Batista',
  ),
  FRA: P(
    'Lucas Hugo Théo Nathan Enzo Mathis Rayan Adrien Warren Bradley Mathys Malo Tom Noah Yanis Ibrahim Moussa Kingsley Maxence Léo Axel Evann Florian Clément',
    'Martin Bernard Dubois Thomas Robert Richard Petit Durand Leroy Moreau Simon Laurent Lefebvre Michel Garcia Camara Diallo Koné Traoré Cissé Lemaire Fournier Girard Bonnet Dupont',
  ),
  ENG: P(
    'Jack Harry Oliver George Charlie Jacob Alfie Noah Freddie Oscar Archie Leo Callum Mason Reece Cole Ethan Tyler Morgan Levi Jaden Harvey Louie Jayden',
    'Smith Jones Taylor Brown Wilson Walker Wright Robinson Thompson White Hughes Edwards Green Hall Wood Harris Lewis Clarke Jackson Scott Turner Parker Cooper Ward',
  ),
  GER: P(
    'Leon Jonas Luca Finn Paul Felix Maximilian Elias Ben Noah Julian Niklas Florian Kai Lennart Tim Moritz Tom Jan Nick Yann Linus Malte Lukas',
    'Müller Schmidt Schneider Fischer Weber Meyer Wagner Becker Schulz Hoffmann Koch Richter Klein Wolf Schröder Neumann Braun Zimmermann Krüger Hartmann Lange Werner Krause Vogel',
  ),
  ITA: P(
    'Francesco Alessandro Lorenzo Leonardo Mattia Andrea Gabriele Riccardo Tommaso Edoardo Federico Nicolò Davide Giacomo Pietro Matteo Fabio Simone Christian Emanuele',
    'Rossi Russo Ferrari Esposito Bianchi Romano Ricci Marino Greco Bruno Gallo Conti De Luca Mancini Costa Giordano Rizzo Lombardi Moretti Fontana Santoro Caruso Ferri Villa',
  ),
  NED: P(
    'Daan Sem Levi Milan Bram Jesse Thijs Lars Ruben Stijn Joey Cody Ryan Micky Quinten Mats Jorrel Ian Wout Niels Teun Gijs',
    'de Jong de Vries van den Berg van Dijk Bakker Janssen Visser Smit Meijer de Boer Mulder de Groot Bos Vos Peters Hendriks van Leeuwen Dekker Brouwer de Wit Koster Willemsen',
  ),
  BEL: P(
    'Arthur Louis Noah Lucas Jules Victor Liam Adam Mathis Jérémy Youri Charles Amadou Leandro Romeo Maxim Arne Senne Mika Julien',
    'Peeters Janssens Maes Jacobs Mertens Willems Claes Goossens Wouters De Smet Dubois Lambert Dupont Martens Vermeulen Hermans Michiels Desmet Lemmens Pauwels',
  ),
  URU: P(
    'Facundo Federico Nicolás Rodrigo Maximiliano Agustín Matías Manuel Mathías Brian Santiago Franco Joaquín Juan Lucas Gastón Emiliano Diego',
    'Rodríguez González Fernández Pérez López Martínez Silva Sosa Suárez Cáceres Cabrera Varela Castro Pereira Méndez Acosta Correa Techera Píriz Morales Núñez',
  ),
  COL: P(
    'Juan Santiago Sebastián Andrés Luis Jhon Daniel Carlos Kevin Jorge Camilo Mateus Wilmar Jefferson Brayan Stiven Harold Deiver',
    'Rodríguez Gómez González Martínez López Hernández Moreno Rojas Sánchez Valencia Ortiz Palacios Mosquera Cortés Jiménez Cardona Ospina Mejía Restrepo Salazar Vélez Montoya Cuesta',
  ),
  MEX: P(
    'José Luis Juan Carlos Jesús Miguel Diego Santiago César Raúl Alexis Gilberto Julián Obed Marcel Germán Johan Kevin Israel Ulises Rodolfo Fernando',
    'Hernández García Martínez López González Pérez Rodríguez Sánchez Ramírez Cruz Flores Gómez Álvarez Huerta Mendoza Aguilar Castillo Ortega Delgado Guerrero Medina Salinas Rivera',
  ),
  USA: P(
    'Tyler Weston Christian Brenden Gio Ricardo Josh Chris Tim Jordan Cameron Malik Kevin Diego Caleb Brandon Jack Aidan Cade Owen Logan Hunter',
    'Johnson Williams Miller Davis Wilson Anderson Taylor Moore Martin Jackson Thompson Robinson Clark Lewis Walker Hall Young Allen King Scott Baker Carter Mitchell Turner',
  ),
  NOR: P(
    'Martin Oscar Jens Sander Andreas Kristoffer Fredrik Magnus Sondre Oskar Leo Jørgen Mathias Emil Henrik Tobias Aron Eirik Håkon Vetle',
    'Hansen Johansen Olsen Larsen Andersen Pedersen Nilsen Kristiansen Jensen Karlsen Johnsen Pettersen Berg Haugen Hagen Halvorsen Jacobsen Strand Lie Moen Dahl',
  ),
  CRO: P(
    'Luka Ivan Marko Josip Mateo Petar Ante Nikola Mario Borna Domagoj Martin Lovro Toni Kristijan Igor Duje Marin Filip Dominik',
    'Horvat Babić Marić Jurić Novak Knežević Vuković Marković Petrović Matić Tomić Božić Grgić Pavić Radić Šimić Brkić Lončar Perić Blažević Barišić',
  ),
  MAR: P(
    'Mohamed Youssef Achraf Hakim Sofyan Azzedine Brahim Ilias Bilal Ayoub Amine Nayef Abdessamad Zakaria Anass Yassine Oussama Adam Hamza Reda',
    'El Amrani Benali Alaoui Idrissi Bennani Tazi Chraibi El Fassi Berrada Lahlou Tahiri Bouzid Ouazzani Sebti Kettani Haddadi Belhaj Naciri Amrani Laaziz',
  ),
  SEN: P(
    'Moussa Cheikh Mamadou Ibrahima Ousmane Abdoulaye Aliou Modou Amadou Serigne Saliou Babacar Assane Omar Alioune Malick Souleymane Youssouph',
    'Diallo Ndiaye Diop Sarr Gueye Fall Mbaye Faye Ba Cissé Sow Niang Camara Dieng Seck Ndour Thiaw Sy Diagne Kane Samb Wade Touré',
  ),
  NGA: P(
    'Chinedu Emeka Obinna Chukwuemeka Tunde Segun Ifeanyi Uche Ikenna Babatunde Yusuf Ahmed Samuel Daniel Michael Chidi Oluwaseun Kingsley Tochukwu',
    'Okafor Okonkwo Adeyemi Eze Nwosu Ogunleye Obi Nwankwo Chukwu Afolabi Bello Okoro Nwachukwu Onuoha Adebayo Ibrahim Salami Olatunji Abiodun',
  ),
  JPN: P(
    'Haruto Sota Yuto Riku Kaito Ren Hayato Kota Yuki Shota Koki Kento Yuito Daiki Tsubasa Naoki Ryota Shun',
    'Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi Kato Yoshida Yamada Sasaki Matsumoto Inoue Kimura Hayashi Shimizu Yamazaki Mori Ikeda Ishikawa Ogawa',
  ),
  KOR: P(
    'Ji-ho Min-jun Seo-jun Do-yun Ha-jun Joon-woo Hyun-woo Ji-hoon Tae-yang Woo-jin Sung-min Dong-hyun Jae-won Min-seok Yeon-woo Chan-young Si-woo Eun-ho',
    'Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim Han Oh Seo Shin Kwon Hwang Ahn Song Jeon Hong Yang Bae Paik',
  ),
  CHN: P(
    'Wei Hao Jun Tao Chen Yang Peng Bin Xin Zhen Long Kai Yu Ming Rui Jie',
    'Wang Li Zhang Liu Chen Yang Huang Zhao Wu Zhou Xu Sun Ma Zhu Hu Guo He Lin Gao Luo',
  ),
  ARAB: P(
    'Mohammed Abdullah Fahad Saud Nasser Ali Omar Khalid Hassan Ahmed Mahmoud Karim Tarek Mostafa Youssef Rami Hamdi Faisal Sultan Majed',
    'Al-Shehri Al-Faraj Al-Qahtani Al-Harbi Al-Ghamdi Al-Otaibi Al-Mutairi Al-Zahrani Al-Anazi Hassan Mansour Haddad Khalil Nasser Saleh Farouk Abdelrahman Ibrahim Mostafa Trabelsi Bouzid',
  ),
  WAFR: P(
    'Kouadio Serge Franck Wilfried Yves Ibrahim Simon Kwame Kofi Yaw Emmanuel Jean Michel Christian Frank Joël Arnaud Patrick Moussa Issa',
    'Koné Traoré Coulibaly Diakité Doumbia Keita Diarra Mensah Owusu Boateng Asante Appiah Ouattara Kouassi Yao Bamba Konaté Sissoko Touré Mbarga Nkoulou Fofana',
  ),
  SLAV: P(
    'Aleksandar Dušan Filip Nemanja Luka Andrej Jan Tomáš Patrik Adam Jakub Milan Stanislav Denis Mykola Artem Marek Ondřej Bogdan Vladimir',
    'Petrović Nikolić Jovanović Marković Stojanović Novák Dvořák Svoboda Kowalski Nowak Wiśniewski Kovalenko Bondarenko Horák Popović Stanković Ilić Kovač Kuzmanović Pavlenko Tkachenko',
  ),
  NORDIC: P(
    'Rasmus Mikkel Christian Andreas Jonas Viktor Emil Alexander Gustav Lucas Anton Hugo William Elias Albin Mattias Oliver Filip',
    'Andersen Nielsen Jensen Larsen Johansson Karlsson Svensson Nyberg Sørensen Lindqvist Eklund Magnusson Lund Dahl Berg Holmberg Petersen Madsen Rasmussen Lindgren Sandberg',
  ),
  LATAM: P(
    'Luis José Carlos Jorge Miguel Kevin Brayan Alexis Joel Moisés Edison Anthony Jordy Óscar Ángel Cristian Fabián Wilmer Jhonny Erick',
    'Hernández González Martínez Rojas Vargas Castillo Morales Ortiz Paredes Valencia Plata Mora Quiñónez Cabrera Benítez Aquino Villalba Cáceres Díaz Ramos Salazar Chávez Espinoza Torres',
  ),
  INT: P(
    'Adam Daniel David Luca Leo Marco Alex Samuel Noah Ryan Kevin Aaron Joel Milan Jonas Nico Andre Mateo Victor Oscar',
    'Novak Costa Silva Müller Petrov Kovac Nielsen Santos Horvat Popescu Ivanov Jansen Martin Garcia Kim Lee Mensah Diallo Moreau Weber Novotny Lindberg',
  ),
}

/** País (código FIFA) → pool. Países sem pool próprio usam o mais próximo cultural/linguisticamente. */
const ALIAS: Record<string, string> = {
  SCO: 'ENG', WAL: 'ENG', IRL: 'ENG', NIR: 'ENG', AUS: 'ENG', NZL: 'ENG', CAN: 'USA', JAM: 'USA', TRI: 'USA',
  SUI: 'GER', AUT: 'GER', LUX: 'FRA', CHI: 'LATAM', PAR: 'LATAM', PER: 'LATAM', ECU: 'LATAM', BOL: 'LATAM',
  VEN: 'LATAM', CRC: 'LATAM', HON: 'LATAM', GUA: 'LATAM', SLV: 'LATAM', PAN: 'LATAM', CUB: 'LATAM', DOM: 'LATAM',
  NCA: 'LATAM', DEN: 'NORDIC', SWE: 'NORDIC', ISL: 'NORDIC', FIN: 'NORDIC', FRO: 'NORDIC', SRB: 'SLAV', SVN: 'SLAV',
  SVK: 'SLAV', CZE: 'SLAV', POL: 'SLAV', UKR: 'SLAV', RUS: 'SLAV', BIH: 'SLAV', MNE: 'SLAV', MKD: 'SLAV', BUL: 'SLAV',
  BLR: 'SLAV', KSA: 'ARAB', QAT: 'ARAB', UAE: 'ARAB', EGY: 'ARAB', TUN: 'ARAB', ALG: 'ARAB', IRQ: 'ARAB', JOR: 'ARAB',
  KUW: 'ARAB', OMA: 'ARAB', BHR: 'ARAB', LBY: 'ARAB', SYR: 'ARAB', LBN: 'ARAB', CIV: 'WAFR', GHA: 'WAFR', CMR: 'WAFR',
  MLI: 'WAFR', BFA: 'WAFR', GUI: 'WAFR', GAB: 'WAFR', COD: 'WAFR', BEN: 'WAFR', TOG: 'WAFR', RSA: 'WAFR', GAM: 'SEN',
  CPV: 'POR', ANG: 'POR', MOZ: 'POR', GNB: 'POR',
}

function poolFor(nationality: string): Pool {
  return POOLS[nationality] ?? POOLS[ALIAS[nationality] ?? ''] ?? POOLS.INT
}

export interface GeneratedName {
  name: string
  shortName: string
}

export function randomName(nationality: string, rng: Rng): GeneratedName {
  const pool = poolFor(nationality)
  const first = rng.pick(pool.first)
  const last = rng.pick(pool.last)
  // sozinho, o sobrenome composto vem com maiúscula: "Virgil van Dijk" → "Van Dijk"
  const shortName = pool.firstNameShort && rng.chance(pool.firstNameShort) ? first : last[0].toUpperCase() + last.slice(1)
  return { name: `${first} ${last}`, shortName }
}

/** Nacionalidades com pool próprio (usadas para ponderar novas gerações). */
export const NAMED_NATIONALITIES = Object.keys(POOLS).filter((k) => k.length === 3 && !['INT'].includes(k))
