import exampleJson from '../../data/travel.example.json';
import type { TravelData } from '../types';
import { normalizeData } from './store';

/** The example travel log (data/travel.example.json), shown by "Load example". */
export function exampleData(): TravelData {
  return normalizeData(exampleJson as Partial<TravelData>);
}
