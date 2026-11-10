// Site settings. (These used to be environment variables in the Node backend.)
// The administrator contact card can also be overridden without redeploying:
// create the Firestore document  settings/site  (see README) and its values win.

export const UNIVERSITY_NAME = 'Mehran University of Engineering and Technology';

export const ADMIN_CONTACT = {
  name: 'Lost & Found Administrator',
  email: 'shaa92903@gmail.com',
  phone: '03222993547',
  office_location: '[xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx]',
  office_hours: '[9:00 am to 3:00 pm]',
};

export const CATEGORIES = [
  'Wallet', 'Phone', 'Keys', 'ID Card', 'Bag', 'Water Bottle',
  'Books & Stationery', 'Electronics', 'Clothing', 'Accessories', 'Documents', 'Other',
];

// zone: used by smart matching ("nearby areas" earn half the location points).
export const LOCATIONS = [
  { name: 'Library', zone: 'academic' },
  { name: 'Computer Lab', zone: 'academic' },
  { name: 'Science Laboratory', zone: 'academic' },
  { name: 'Classroom Block A', zone: 'academic' },
  { name: 'Classroom Block B', zone: 'academic' },
  { name: 'Administration Block', zone: 'academic' },
  { name: 'Cafeteria', zone: 'social' },
  { name: 'Student Center', zone: 'social' },
  { name: 'Prayer Area', zone: 'social' },
  { name: 'Sports Ground', zone: 'outdoor' },
  { name: 'Parking Area', zone: 'outdoor' },
  { name: 'Main Gate', zone: 'outdoor' },
  { name: 'Bus Stop', zone: 'outdoor' },
  { name: 'Hostel', zone: 'residential' },
  { name: 'Other / Not sure', zone: 'other' },
];

// Where photos are kept:
//   'firestore' = free Spark plan: the browser shrinks each photo and saves it in Firestore (no billing needed)
//   'storage'   = Firebase Storage (needs the Blaze plan)
export const IMAGE_MODE = 'firestore';
export const MAX_IMAGE_MB = 3;            // keep in sync with firebase/storage.rules
export const PAGE_SIZE = 12;              // Browse page size
export const MAX_ITEMS_LOADED = 500;      // newest reports loaded for browsing / admin
