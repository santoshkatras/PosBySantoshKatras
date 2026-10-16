// Suggest an Indian HSN code and GST rate from a product's name and category.
// Rates follow the GST rate rationalisation in force from 22 Sep 2025 (slabs 0, 5, 18, 40).
// These are suggestions: the shop should confirm them for its own invoices.
const RULES = [
  // stationery and books
  [/\b(books?|novel|autobiograph|textbook|paperback|hardcover)\b/, '4901', '0', 'Printed books'],
  [/\b(notebooks?|exercise book|note book|register|graph book|spiral)\b/, '4820', '0', 'Notebooks / exercise books'],
  [/\b(pencils?|crayons?|sharpener)\b/, '9609', '0', 'Pencils and crayons'],
  [/\b(eraser|rubber)\b/, '4016', '0', 'Erasers'],
  [/\b(maps?|atlas|globe|charts?)\b/, '4905', '0', 'Maps and charts'],
  [/\b(pens?|ball ?pen|gel pen|marker|highlighter)\b/, '9608', '18', 'Pens and markers'],
  // food and beverages
  [/\b(noodles?|pasta|macaroni|vermicelli|maggi)\b/, '1902', '5', 'Pasta and noodles'],
  [/\b(biscuits?|cookies?|cakes?|rusk|wafers?|crackers?)\b/, '1905', '5', 'Biscuits and bakery'],
  [/\b(chocolates?|cocoa)\b/, '1806', '5', 'Chocolate'],
  [/\b(namkeen|bhujia|mixture|snacks?|chips|crisps)\b/, '2106', '5', 'Namkeen and snacks'],
  [/\b(ketchup|sauces?|mayonnaise|pickles?|chutney)\b/, '2103', '5', 'Sauces and pickles'],
  [/\b(instant coffee|coffee)\b/, '0901', '5', 'Coffee'],
  [/\b(tea|chai)\b/, '0902', '5', 'Tea'],
  [/\b(ghee|butter)\b/, '0405', '5', 'Butter and ghee'],
  [/\b(cheese|paneer)\b/, '0406', '5', 'Cheese and paneer'],
  [/\b(milk)\b/, '0401', '0', 'Milk'],
  [/\b(soft drinks?|cola|carbonated|aerated|soda|energy drink)\b/, '2202', '40', 'Aerated / carbonated drinks'],
  [/\b(packaged drinking water|mineral water|water bottle)\b/, '2201', '5', 'Packaged drinking water'],
  [/\b(juices?|nectar)\b/, '2009', '5', 'Fruit juices'],
  [/\b(edible oil|sunflower oil|mustard oil|groundnut oil|olive oil|cooking oil|soybean oil)\b/, '1512', '5', 'Edible oils'],
  [/\b(rice|basmati)\b/, '1006', '5', 'Rice (packaged)'],
  [/\b(atta|wheat flour|maida|besan|flour)\b/, '1101', '5', 'Flour (packaged)'],
  [/\b(sugar)\b/, '1701', '5', 'Sugar'],
  [/\b(salt)\b/, '2501', '0', 'Salt'],
  [/\b(spices?|masala|turmeric|chilli powder|pepper)\b/, '0910', '5', 'Spices and masala'],
  [/\b(dal|pulses?|lentils?)\b/, '0713', '5', 'Pulses (packaged)'],
  // personal care and home
  [/\b(toothpaste|tooth paste|dental cream)\b/, '3306', '5', 'Toothpaste'],
  [/\b(toothbrush|tooth brush)\b/, '9603', '5', 'Toothbrushes'],
  [/\b(shampoo|hair oil|conditioner|hair care)\b/, '3305', '5', 'Hair care'],
  [/\b(soap|body wash|handwash|hand wash)\b/, '3401', '5', 'Soap'],
  [/\b(perfume|deodorant|fragrance|eau de)\b/, '3303', '18', 'Perfume and deodorant'],
  [/\b(cosmetics?|skin care|serum|cream|lotion|makeup|lipstick|face wash|sunscreen)\b/, '3304', '18', 'Cosmetics and skin care'],
  [/\b(detergent|washing powder|dishwash|surf|cleaner)\b/, '3402', '18', 'Detergents and cleaners'],
  [/\b(toys?|puzzle|board game)\b/, '9503', '5', 'Toys'],
  // electronics and computers
  [/\b(mobile|smartphone|iphone|cell ?phone|telephon)/, '8517', '18', 'Mobile phones'],
  [/\b(laptop|notebook computer|macbook|desktop|computer|cpu|tablet|ipad)\b/, '8471', '18', 'Computers and laptops'],
  [/\b(mouse|keyboard|webcam|ssd|hard disk|hdd|motherboard|graphics card|ram)\b/, '8471', '18', 'Computer parts and peripherals'],
  [/\b(monitor|television|tv|led tv|smart tv)\b/, '8528', '18', 'Monitors and televisions'],
  [/\b(printer|cartridge|toner)\b/, '8443', '18', 'Printers and cartridges'],
  [/\b(cable|charger|adapter|usb|hdmi|power bank)\b/, '8544', '18', 'Cables and chargers'],
  [/\b(headphones?|earphones?|earbuds|speakers?|soundbar)\b/, '8518', '18', 'Headphones and speakers'],
  [/\b(memory card|pen ?drive|sd card|flash drive|micro sd)\b/, '8523', '18', 'Memory cards and pen drives'],
  [/\b(router|modem|wi-?fi|switch)\b/, '8517', '18', 'Networking equipment'],
  [/\b(air conditioner|ac unit)\b/, '8415', '18', 'Air conditioners'],
  [/\b(car battery|batter(y|ies)|inverter battery)\b/, '8507', '18', 'Batteries'],
  // auto and bike
  [/\b(engine oil|lubricant|motor oil|gear oil|coolant)\b/, '2710', '18', 'Lubricants and oils'],
  [/\b(tyres?|tires?|tubes?)\b/, '4011', '18', 'Tyres'],
  [/\b(brake pads?|clutch|spark plug|air filter|oil filter|chain sprocket|wiper|auto parts?|spare parts?|bike parts?|car parts?)\b/, '8708', '18', 'Vehicle parts'],
  [/\b(helmet)\b/, '6506', '5', 'Helmets'],
];

export function guessHsn(...texts) {
  const text = texts.filter(Boolean).join(' ').toLowerCase();
  if (!text) return null;
  for (const [pattern, hsn, gstRate, label] of RULES) {
    if (pattern.test(text)) return { hsn, gstRate, label };
  }
  return null;
}
