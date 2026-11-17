// src/data/katalogAwal.ts
// Titik awal katalog Merek & Model. Ini daftar pabrikan dan kode unit yang nyata
// ada — bukan data contoh transaksi — dan hanya masuk ke store kalau pengguna
// menekan "Muat Katalog Awal" di halaman Merek & Model.
//
// Kenapa tidak otomatis: halaman ini dulunya mengisi dirinya sendiri lewat
// INITIAL_BRANDS/INITIAL_MODELS di dalam komponen, sehingga katalog yang tampil
// tidak pernah bisa dipercaya sebagai isi perusahaan (dan semua perubahan hilang
// saat halaman ditutup). Nama merek di bawah juga disamakan dengan cara `units.brand`
// dan `units.model` ditulis oleh aplikasi ini (mis. 'Caterpillar', bukan
// 'Caterpillar (CAT)'), supaya pemeriksaan "merek masih dipakai unit"
// (electron/referential.ts) menemukan rujukannya.

export interface KatalogMerek {
  name: string;
  country: string;
  category: string;
  description: string;
}

export interface KatalogModel {
  brandName: string;
  modelCode: string;
  category: string;
  capacity: string;
  enginePower: string;
  operatingWeight: string;
}

export const KATALOG_MEREK: KatalogMerek[] = [
  {
    name: 'SANY',
    country: 'Tiongkok',
    category: 'Excavator, Crane, Concrete Pump',
    description: 'Produsen alat berat terkemuka dunia dengan teknologi hidrolik canggih',
  },
  {
    name: 'Komatsu',
    country: 'Jepang',
    category: 'Excavator, Bulldozer, Dump Truck',
    description: 'Merek alat berat Jepang berstandar tinggi untuk konstruksi dan pertambangan',
  },
  {
    name: 'Caterpillar',
    country: 'Amerika Serikat',
    category: 'Excavator, Wheel Loader, Dozer',
    description: 'Produsen mesin dan peralatan konstruksi/tambang terbesar di dunia',
  },
  {
    name: 'Kobelco',
    country: 'Jepang',
    category: 'Excavator, Crane',
    description: 'Spesialis excavator hemat energi dan efisiensi tinggi',
  },
  {
    name: 'Hitachi',
    country: 'Jepang',
    category: 'Excavator, Wheel Loader',
    description: 'Excavator pertambangan dan konstruksi berdaya tahan tinggi',
  },
  {
    name: 'Volvo',
    country: 'Swedia',
    category: 'Articulated Hauler, Wheel Loader',
    description: 'Peralatan konstruksi terdepan dalam keselamatan dan ergonomi',
  },
];

export const KATALOG_MODEL: KatalogModel[] = [
  {
    brandName: 'SANY', modelCode: 'SY215C', category: 'Excavator 20 Ton',
    capacity: '1.0 m³', enginePower: '128 kW / 2000 rpm', operatingWeight: '21.900 kg',
  },
  {
    brandName: 'SANY', modelCode: 'SY365H', category: 'Excavator 36 Ton',
    capacity: '1.6 m³', enginePower: '205 kW / 1900 rpm', operatingWeight: '36.200 kg',
  },
  {
    brandName: 'Komatsu', modelCode: 'PC200-8', category: 'Excavator 20 Ton',
    capacity: '0.93 m³', enginePower: '103 kW / 2000 rpm', operatingWeight: '20.500 kg',
  },
  {
    brandName: 'Komatsu', modelCode: 'D85ESS-2', category: 'Bulldozer',
    capacity: '3.4 m³ Blade', enginePower: '161 kW / 1900 rpm', operatingWeight: '20.670 kg',
  },
  {
    brandName: 'Caterpillar', modelCode: '320 GC', category: 'Excavator 20 Ton',
    capacity: '1.0 m³', enginePower: '107 kW / 1800 rpm', operatingWeight: '20.500 kg',
  },
  {
    brandName: 'Caterpillar', modelCode: '777G', category: 'Off-Highway Dump Truck',
    capacity: '60 m³', enginePower: '765 kW / 1750 rpm', operatingWeight: '163.000 kg',
  },
];
