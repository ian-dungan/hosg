// Test fixture: common real surnames and place names of several languages, which a name filter must let
// through. Many hold a blocked letter sequence inside an innocent word (the "Scunthorpe" kind); those are
// exempted by ALLOWED_WORDS in names.ts. Tests only: never import this from index.ts or shipped code.

/** Common surnames: English, Scottish, Irish, Welsh, German, Dutch, French, Italian, Spanish, Portuguese, Nordic, Slavic and more. */
export const SURNAMES: readonly string[] = [
  // English, Scottish, Irish, Welsh
  'Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davies', 'Evans', 'Wilson', 'Thomas', 'Johnson', 'Roberts', 'Robinson',
  'Thompson', 'Wright', 'Walker', 'White', 'Edwards', 'Hughes', 'Green', 'Hall', 'Lewis', 'Harris', 'Clarke', 'Patel',
  'Jackson', 'Wood', 'Turner', 'Martin', 'Cooper', 'Hill', 'Ward', 'Morris', 'Moore', 'Clark', 'Lee', 'King', 'Baker',
  'Harrison', 'Morgan', 'Allen', 'James', 'Scott', 'Phillips', 'Watson', 'Davis', 'Parker', 'Price', 'Bennett', 'Young',
  'Griffiths', 'Mitchell', 'Kelly', 'Cook', 'Carter', 'Richardson', 'Bailey', 'Collins', 'Bell', 'Shaw', 'Murphy', 'Miller',
  'Cox', 'Richards', 'Khan', 'Marshall', 'Anderson', 'Simpson', 'Ellis', 'Adams', 'Singh', 'Begum', 'Wilkinson', 'Foster',
  'Chapman', 'Powell', 'Webb', 'Rogers', 'Gray', 'Mason', 'Ali', 'Hunt', 'Hussain', 'Campbell', 'Matthews', 'Owen', 'Palmer',
  'Holmes', 'Mills', 'Barnes', 'Knight', 'Lloyd', 'Butler', 'Russell', 'Barker', 'Fisher', 'Stevens', 'Jenkins', 'Murray',
  'Dixon', 'Harvey', 'Graham', 'Pearson', 'Ahmed', 'Fletcher', 'Walsh', 'Kaur', 'Gibson', 'Howard', 'Andrews', 'Stewart',
  'Elliott', 'Reynolds', 'Saunders', 'Payne', 'Fox', 'Ford', 'Pearce', 'Day', 'Brooks', 'West', 'Lawrence', 'Cole',
  'Atkinson', 'Bradley', 'Spencer', 'Gill', 'Dawson', 'Ball', 'Burton', 'Obrien', 'Watts', 'Rose', 'Booth', 'Perry', 'Ryan',
  'Grant', 'Wells', 'Armstrong', 'Francis', 'Rees', 'Hayes', 'Hart', 'Hudson', 'Newman', 'Barrett', 'Webster', 'Hunter',
  'Gregory', 'Carr', 'Lowe', 'Page', 'Marsh', 'Riley', 'Dunn', 'Woods', 'Parsons', 'Berry', 'Stone', 'Reid', 'Holland',
  'Hawkins', 'Harding', 'Porter', 'Robertson', 'Newton', 'Oliver', 'Reed', 'Kennedy', 'Williamson', 'Bird', 'Gardner',
  'Shah', 'Dean', 'Lane', 'Cooke', 'Bates', 'Henderson', 'Parry', 'Burgess', 'Bishop', 'Walton', 'Burns', 'Nicholson',
  'Shepherd', 'Ross', 'Cross', 'Long', 'Freeman', 'Warren', 'Nicholls', 'Hamilton', 'Byrne', 'Sutton', 'McDonald', 'Yates',
  'Hodgson', 'Robson', 'Curtis', 'Hopkins', "O'Connor", 'Harper', 'Coleman', 'Watkins', 'Moss', 'McCarthy', 'Chambers',
  'Drew', 'Griffin', 'Sharp', 'Hutchinson', 'Cockburn', 'Cockcroft', 'Cockerill', 'Hancock', 'Wilcox', 'Alcock', 'Laycock',
  'Glasscock', 'Peacocke', 'Silcock', 'Adcock', 'Hitchcock', 'Babcock', 'Woodcock', 'Cockrell', 'Dickens',
  'Dickinson', 'Dickerson', 'Dickey', 'Dickman', 'Dixon', 'Dickenson', 'Cumming', 'Cummings',
  'Cumberbatch', 'Slocum', 'Titmuss', 'Titley', 'Assange', 'Lassiter', 'Passmore', 'Massie', 'Cassidy',
  'Hassell', 'Bassett', 'Glass', 'Gasson', 'Sexton', 'Sexsmith', 'Essex', 'Shufflebottom',
  'Ramsbottom', 'Higginbottom', 'Sidebottom', 'Winterbottom', 'Pratt', 'Coxon', 'Willcocks', 'Penistone',
  // German, Dutch, Scandinavian
  'Muller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Bauer',
  'Richter', 'Klein', 'Wolf', 'Schroeder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Kruger', 'Hofmann', 'Hartmann',
  'Lange', 'Schmitt', 'Werner', 'Krause', 'Meier', 'Lehmann', 'Schmid', 'Schulze', 'Maier', 'Kohler', 'Herrmann', 'Konig',
  'Fuchs', 'Kuhn', 'Pohl', 'Brandt', 'Jansen', 'Dekker', 'Bakker', 'Visser', 'Smit', 'Mulder', 'Bos', 'Vos', 'Peters',
  'Hendriks', 'Dijkstra', 'Kok', 'Fokker', 'Hansen', 'Johansen', 'Olsen', 'Larsen', 'Andersen', 'Pedersen', 'Nilsen',
  'Kristiansen', 'Eriksson', 'Karlsson', 'Nilsson', 'Lindqvist', 'Lundgren', 'Bergstrom', 'Virtanen', 'Korhonen',
  'Fick',
  // French, Italian, Spanish, Portuguese
  'Martin', 'Bernard', 'Dubois', 'Durand', 'Lefebvre', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Michel', 'Garcia', 'David',
  'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'Andre', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'Francois',
  'Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo',
  'Conti', 'DeLuca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti',
  'Rodriguez', 'Gonzalez', 'Fernandez', 'Lopez', 'Martinez', 'Sanchez', 'Perez', 'Gomez', 'Diaz', 'Hernandez', 'Alvarez',
  'Moreno', 'Munoz', 'Romero', 'Alonso', 'Gutierrez', 'Navarro', 'Torres', 'Dominguez', 'Vazquez', 'Ramos', 'Gil',
  'Silva', 'Santos', 'Ferreira', 'Pereira', 'Oliveira', 'Rodrigues', 'Martins', 'Jesus', 'Sousa', 'Fernandes', 'Goncalves',
  'Cunha', 'Cagliari',
  // Slavic, Hungarian, Greek, Turkish
  'Nowak', 'Kowalski', 'Wisniewski', 'Wojcik', 'Kowalczyk', 'Kaminski', 'Lewandowski', 'Zielinski', 'Szymanski', 'Ivanov',
  'Smirnov', 'Kuznetsov', 'Popov', 'Novak', 'Horvat', 'Kovac', 'Nagy', 'Kovacs', 'Toth', 'Szabo', 'Papadopoulos',
  'Yilmaz', 'Kaya', 'Demir', 'Sahin', 'Celik', 'Hora',
  // Asian, African and others
  'Wang', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Zhou', 'Nguyen', 'Tran', 'Pham', 'Phuc', 'Kim',
  'Park', 'Choi', 'Jung', 'Kang', 'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura',
  'Kobayashi', 'Matsushita', 'Fukuda', 'Fukushima', 'Kumar', 'Sharma', 'Gupta', 'Das', 'Rao', 'Reddy', 'Nair', 'Okafor',
  'Okonkwo', 'Mensah', 'Mwangi', 'Nkosi', 'Dlamini', 'Ndlovu', 'Haddad', 'Nasser', 'Hassan', 'Mohammed', 'Cohen', 'Levi',
  'Mizrahi', 'Peretz', 'Biton',
];

/** Place names: towns, rivers and regions. */
export const PLACES: readonly string[] = [
  'London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Edinburgh', 'Cardiff', 'Belfast', 'Bristol', 'Liverpool',
  'Sheffield', 'Newcastle', 'Nottingham', 'Leicester', 'Coventry', 'Bradford', 'Hull', 'Plymouth', 'Southampton', 'Reading',
  'Derby', 'Aberdeen', 'Dundee', 'Swansea', 'York', 'Bath', 'Oxford', 'Cambridge', 'Canterbury', 'Durham', 'Exeter',
  'Scunthorpe', 'Penistone', 'Clitheroe', 'Sussex', 'Wessex', 'Middlesex', 'Essex', 'Lightwater',
  'Cockington',
  'Dorking', 'Bournemouth', 'Arsenal', 'Matlock', 'Sandwich',
  'Penicuik', 'Cumbernauld', 'Cumbria', 'Cumnock', 'Ashby',
  'Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Nantes', 'Bordeaux', 'Lille', 'Rennes', 'Brest',
  'Berlin', 'Hamburg', 'Munich', 'Cologne', 'Frankfurt', 'Stuttgart', 'Dresden', 'Leipzig', 'Bremen', 'Hanover',
  'Kissing', 'Wedding', 'Rome', 'Milan', 'Naples', 'Turin', 'Florence', 'Venice', 'Genoa', 'Bologna',
  'Montenegro', 'Negroni', 'Nigeria', 'Madrid', 'Barcelona', 'Valencia', 'Seville', 'Bilbao', 'Malaga', 'Lisbon',
  'Porto', 'Amsterdam', 'Rotterdam', 'Utrecht', 'Brussels', 'Antwerp', 'Ghent', 'Vienna', 'Zurich', 'Geneva', 'Basel',
  'Prague', 'Brno', 'Warsaw', 'Krakow', 'Gdansk', 'Budapest', 'Debrecen', 'Athens', 'Istanbul', 'Ankara', 'Cairo', 'Lagos',
  'Nairobi', 'Accra', 'Tokyo', 'Osaka', 'Kyoto', 'Fukuoka', 'Shiitake', 'Seoul', 'Busan', 'Beijing', 'Shanghai', 'Hanoi',
  'Phuket', 'Bangkok', 'Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Dhaka', 'Karachi', 'Lahore', 'Kabul', 'Tehran', 'Baghdad',
  'Boston', 'Chicago', 'Denver', 'Dallas', 'Austin', 'Phoenix', 'Seattle', 'Portland', 'Atlanta', 'Miami',
  'Toronto', 'Montreal', 'Vancouver', 'Ottawa', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Auckland',
  'Wellington',
  'Sexsmith', 'Assisi', 'Cassino', 'Passau', 'Gassino', 'Hassfurt',
  'Kassel', 'Lassay', 'Sassari', 'Massa', 'Pisa', 'Pescara', 'Arezzo', 'Dakar', 'Kinshasa',
];
