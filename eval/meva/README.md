# MEVA activity annotations (evaluation ground truth)

These `*.activities.yml` files are unmodified copies from the MEVA annotation repository
(`annotation/DIVA-phase-2/MEVA/kitware/2018-03-07/11/` in https://gitlab.kitware.com/meva/meva-data-repo), for eight
cameras of the 11:00-11:05 window on 7 March 2018 (school site: G328, G339, G419, G420; bus site: G505, G506, G508,
G509). The matching videos are in the public MEVA bucket (`s3://mevadata-public-01/drops-123-r13/2018-03-07/11/`) and
can be imported from the app (Cameras -> Import an archive -> MEVA).

"Multiview Extended Video with Activities" (MEVA) dataset by Kitware Inc. and the Intelligence Advanced Research
Projects Activity (IARPA) is licensed under a Creative Commons Attribution 4.0 International License
(http://creativecommons.org/licenses/by/4.0/).

`../build-meva-queries.mjs` turns them into the activity queries in `../queries.json`.
