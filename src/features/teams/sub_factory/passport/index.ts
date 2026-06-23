// App Readiness Passport — project-comparison matrix module. Mirrors ascent's
// app-passport.schema.json; renders dev_tools projects-as-columns ×
// passport-items-as-rows. Data derived live from the cross-project scan.
export { ProjectsPassportWall } from './ProjectsPassportWall';
export { usePassportData } from './usePassportData';
export { derivePassportFromMetadata } from './passportDerive';
export { sortByNameAsc, type AppPassport } from './passportModel';
