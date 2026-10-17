# Soil Trafficability Forecasting

**Marie-France Jones, Paul Arp**  
Faculty of Forestry and Environmental Management, University of New Brunswick, Fredericton, Canada  
Email: \*arp1@unb.ca

**How to cite this paper:** Jones, M.-F., & Arp, P. (2019). Soil Trafficability Forecasting. *Open Journal of Forestry*, 9, 296-322. https://doi.org/10.4236/ojf.2019.94017

**Received:** July 12, 2019  
**Accepted:** September 26, 2019  
**Published:** September 29, 2019  

Copyright © 2019 by author(s) and Scientific Research Publishing Inc. This work is licensed under the Creative Commons Attribution International License (CC BY 4.0). http://creativecommons.org/licenses/by/4.0/

---

## Abstract

This article introduces and evaluates a Soil Trafficability Model (STRAM) designed to estimate and forecast potential rutting depth on forest soils due to heavy machine traffic. This approach was developed within the wood-forwarding context of four harvest blocks in Northern and Central New Brunswick. Field measurements used for model calibration involved determining soil rut depths, volumetric moisture content, bulk density, soil resistance to cone penetration (referred to as cone index, or $CI$), and the dimensionless nominal soil cone index ($NCI$) defined by the ratio of $CI$ over wheel footprint pressure. With STRAM, rut depth is inferred from: 1) machine dimensions pertaining to estimating footprint area and pressure; 2) pore-filled soil moisture content and related $CI$ projections guided by year-round daily weather records using the Forest Hydrology Model (ForHyM); 3) accounting for within-block soil property variations using multiple and Random Forest regression techniques. Subsequent evaluations of projected soil moisture, $CI$ and rut-depth values accounted for about 40 (multiple regression) and 80 (Random Forest) percent of the corresponding field measured values.

**Keywords:** Soil Trafficability, Wood Forwarding, Plot Surveys, Regression Comparisons, Cartographic Depth-to-Water

---

## 1. Introduction

With the wide-spread use of modern mechanized harvest machinery, forest and agricultural planners have to deal with the effects of heavy machine loads on soil rutting, compaction, erosion, and subsequent reductions in crop yields (Brady & Weil, 2008). Increased soil compaction reduces soil porosity, increases soil runoff, damages and crushes roots, and leads to reduced root growth due to decreased soil oxygen levels (Grigal, 2000; Horn et al., 2004; Bassett et al., 2005; Singer & Munns, 2006; Chen & Weil, 2011). Rutting results from combined soil compaction and soil displacement. Soil displacement occurs when soils within depressions and along slopes are moist to wet at or above field capacity (Raper, 2005; Naghdi et al., 2009). Depending on their slope orientations, ruts increase, decrease, or collect run-off (Sutherland, 2003; Antille & Godwin, 2013; Poltorak et al., 2018).

A measure of soil resistance to penetration, known as cone index ($CI$), is used to assess soil compaction and rutting. This measure varies from weak to strong as soil moisture content decreases, and this is particularly so in fine-textured soils. In contrast, sandy soils remain friable from wet to dry (Earl, 1997; Vaz, 2003; Dexter et al., 2007; Tekeste et al., 2008; Vaz et al., 2011; Kumar et al., 2012; Jones & Arp, 2017).

To comply with best forest management practices, various jurisdictions have established criteria as to what constitutes a rut. For example, the Province of British Columbia (Canada) classifies ruts $> 15\text{ cm}$ deep to be a hazardous disturbance. The Pacific Northwest region of the USA defines ruts to be $> 15\text{ cm}$ deep as well (Page-Dumroese et al., 2000). The Province of Alberta considers any soil disturbance tracking deeper than $10\text{ cm}$ as ruts (Alberta Forest Products Association, 1994; Van Rees, 2002). A visual representation of minor to severe soil disturbance classes including rut depths is provided in **Figure A1**.

Earlier rut-depth prediction models by Maclaurin (1990) and Rantala (2001) related rut depth as caused by single wheel and single machine passes to the ratio of tire footprint pressure over soil resistance to penetration, also referred to as nominal cone index, or $NCI$ (**Table 1**). Scholander (1974) and Saarilahti (2002a) extended this approach towards multiple passes. Vega-Nieva et al. (2009) modified the $NCI$-based multi-pass regression model by examining the experimental data for a sandy soil and a clay loam soil at varying moisture contents, and with a wood-forwarding rut-depth data by Meek (1996) suggestion to correct for coarse fragment content. A recent study by Sirén et al. (2019) related rut depth to number of machine passes, volumetric soil moisture content, and $CI$. All these studies, however, captured only a small portion of field-determined rut depth variations whether based on fixed or fixed plus random effects regression models.

**Table 1.** Select rut depth models.

| Rut Depth Parameter | Citation | Rut Depth Equation |
| :--- | :--- | :--- |
| First wheel pass | Maclaurin (1990) | $Z = d \times \frac{0.224}{NCI^{1.25}}$ |
| First cycle pass | Rantala (2001) | $Z = -0.026 + \frac{0.629}{NCI}$ |
| Multi-pass | Scholander (1974) | $Z_n = Z_1 \times n^{\frac{1}{a}}$ |
| | Saarilahti (2002a) | $Z_n = \left( Z_{n-1}^{a_n} + Z_1^{a_n} \right)^{\frac{1}{a_n}}$ |
| | Vega-Nieva et al. (2009) | $Z_n = \frac{r_1}{NCI} n^{\frac{1}{\left(p_1 NCI^{p_2}\right)}} (1 - CF)^2$ |
| | Sirén et al. (2019) | $\log Z = b_0 + b_1 M + b_2 MC_v + b_3 CI + u_{sc} + e_{sc}$ |

*$d =$ wheel diameter; $CI =$ cone index; $n =$ number of passes; $NCI =$ nominal cone index; $CF =$ coarse fragment; $M =$ pass-cumulative machine mass; $a, a_n, b_0, b_1, b_2, b_3, p_1, p_2 =$ multi-pass coefficients; $r_1 =$ site specific calibration parameter; $u_{sc}, e_{sc} =$ random effects; NR: not reported.*

This article reports on the extent of improving wood-forwarding rut-depth modelling based on:
1) Using field-determined data for soil density, texture, organic matter, coarse fragment and weather-inferred ridge-to-valley soil moisture, $CI$, and machine-specific $NCI$ variations for the rut-depth projection purpose.
2) Employing fixed and random forest regression techniques for optimizing these projections.
3) Selecting four of the eleven harvest blocks described in Jones and Arp (2019) for detailed analysis; this involved assessing wood-forwarding tracks across two shelterwood cutting blocks and across two commercial thinning blocks in Northern and Central New Brunswick, Canada.

---

## 2. Study Locations, Materials and Methods

### 2.1. Block Descriptions

Details regarding the wood-forwarding operations within the four harvest blocks chosen for this study are presented in **Figure 1** & **Figure 2** by location, and in **Table 2** by block-specific attributes. These blocks are a subset of the 11 blocks used by Jones and Arp (2019) for their on and off-track soil moisture and $CI$ study.

*(Figure 1: Block and weather station locations (Blocks 1 to 11), with Blocks 1, 2, 3, and 9 selected for rut depth determinations following wood forwarding. Background: digital elevation model for New Brunswick, $1\text{ m}$ resolution.)*

*(Figure 2: Plot-specific machine tracks (top) and photos (bottom) for Blocks 1, 2, 3, and 9.)*

**Table 2.** Block descriptions: geographical location, forest type, elevation, slope, aspect, soil association, and plot determination counts for $MC$, $CI$, and rut depths.

| Block | Lat/Long Coord. | Operation Date | MC/CI Sample Date | Rut Sample Date | Forest Type | Tree Species | Operation | Soil Association | Elevation ($\text{m}$) | Slope ($^\circ$) | Aspect ($^\circ$) | MC/CI Plots | Rut Plots |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | $47^\circ 15' 4.071"\text{N}$<br>$67^\circ 37' 27.102"\text{W}$ | 5/2014 | 27/5/2014 | 21/10/2014 | SWPL | WS | CT | Victoria | 267 | 2.5 | 158 | 56 | 29 |
| 2 | $47^\circ 14' 21.825"\text{N}$<br>$67^\circ 37' 26.918"\text{W}$ | 6/2014 | 21/10/2014 | 21/10/2014 | SWPL | WS | CT | Victoria | 265 | 3.4 | 112 | 28 | 40 |
| 3 | $47^\circ 32' 23.622"\text{N}$<br>$67^\circ 47' 46.291"\text{W}$ | 6/2014 | 11/6/2014 | 20/10/2014 | IntHW | BI/RM | SHW | Glassville | 351 | 4.6 | 189 | 80 | 75 |
| 4 | $47^\circ 14' 59.254"\text{N}$<br>$67^\circ 37' 18.822"\text{W}$ | 5/2014 | 12/6/2014 | | SWPL | BS | CC | McGee | 280 | 3.1 | 127 | 46 | |
| 5 | $47^\circ 18' 20.725"\text{N}$<br>$67^\circ 31' 42.636"\text{W}$ | 7/2014 | 15/7/2014 | | SWPL | WS | CT | Glassville | 388 | 9.1 | 149 | 33 | |
| 6 | $47^\circ 12' 15.037"\text{N}$<br>$67^\circ 14' 17.548"\text{W}$ | 6/2014 | 4/6/2014 | | MW | EH/YB/M | SC | Jacquet River | 210 | 4.6 | 148 | 26 | |
| 7 | $46^\circ 12' 24.987"\text{N}$<br>$67^\circ 15' 55.072"\text{W}$ | 6/2014 | 4/6/2014 | | MW | EH/YB/M | SC | Jacquet River | 203 | 5.5 | 158 | 43 | |
| 8 | $46^\circ 42' 51.411"\text{N}$<br>$67^\circ 3' 38.865"\text{W}$ | 6/2014 | 19/6/2014 | | TolHW | SM/YB | SHW | Juniper | 418 | 4.5 | 140 | 54 | |
| 9 | $46^\circ 10' 42.560"\text{N}$<br>$66^\circ 56' 30.534"\text{W}$ | 10/2014 | 20/8/2014 | 19/11/2014 | TolHW | SM/YB | CC | Long Lake | 277 | 2.0 | 182 | 24 | 63 |
| 10 | $46^\circ 26' 23.956"\text{N}$<br>$67^\circ 15' 24.656"\text{W}$ | 9/2012 | 19/6/2013 | | TolHW | SM/YB | SHW | Popple Depot | 422 | 8.9 | 185 | 147 | |
| 11 | $46^\circ 20' 44.440"\text{N}$<br>$67^\circ 15' 1.278"\text{W}$ | 10/2012 | 25/6/2013 | | TolHW | SM/YB | SHW | Kingston | 319 | 9.6 | 214 | 159 | |

*SWPL: softwood plantation, IntHW: intolerant hardwood, MW: mixedwood, TolHW: tolerant hardwood. BS: black spruce; WS: white spruce, BI: birch, YB: yellow birch; RM: red maple; SM: sugar maple; EH: eastern hemlock. CT: commercial thinning, CC: clear cut, SHW: Shelterwood, SC: select cut.*

Blocks 1 and 2 are within $1\text{ km}$ of each other, and share similar site characteristics. They are located within the Western reach of the Chaleur uplands. Both blocks are white spruce (*Picea glauca* (Moench) Voss) plantations. Block 1 covers a two hectare area. Block 2 covers $20.8\text{ ha}$, but was sampled across a $3.5\text{ ha}$ area. The region has a mean annual temperature of $3.8^\circ\text{C}$, with mean January and July temperatures at $-11.5^\circ\text{C}$ and $18.2^\circ\text{C}$ respectively. Mean annual precipitation amounts to $1110\text{ mm}$, with $300\text{ mm}$ as snow (Department of Environment and Climate Change Canada, 2016a). Surficial deposits vary from morainal sediments to loamy lodgment tills, underlain by late Ordovician marine clastics.

Block 3 is a $20.9\text{ ha}$ shelterwood cut located in the southern reach of Notre Dame Mountains, within the Appalachians Mountain range. The area has a mean air temperature of $3.5^\circ\text{C}$ with mean January and July temperatures at $-12.9^\circ\text{C}$ to $17.6^\circ\text{C}$, respectively. It has a mean precipitation of $1140\text{ mm}$, with $310\text{ mm}$ as snow (Department of Environment and Climate Change Canada, 2016a). This block supports moderate to intolerant hardwood/mixedwood vegetation, mostly composed of red maple (*Acer rubrum* L.), yellow birch (*Betula alleghaniensis* Britt.) and balsam fir (*Abies balsamea* L.). Bedrock formations involve late Ordovician deep-water marine clastics, with topography ranging from gentle, rolling plateaus to steep valleys of hummocky ablation moraines.

Block 9 is a $25.5\text{ ha}$ shelterwood cut located in the Southern tip of the Miramichi highlands, roughly $50\text{ km}$ northwest from Fredericton, the provincial capital for New Brunswick. The area has a mean air temperature of $5.5^\circ\text{C}$, with mean January and July temperatures at $-9.4^\circ\text{C}$ and $19.4^\circ\text{C}$, respectively. Mean annual precipitation amounts to $1100\text{ mm}$, with $250\text{ mm}$ as snow (Department of Environment and Climate Change Canada, 2016a). This block supports natural mixedwood and tolerant hardwoods, including Eastern hemlock (*Tsuga canadensis* L. Carrière), yellow birch, sugar maple (*Acer saccharum* Marsh.), beech (*Fagus grandifolia* Ehrh.), balsam fir, Eastern white cedar (*Thuja occidentalis* L.), and black spruce (*Picea mariana* Mill). Surficial deposits vary from morainal sediments to ablation and boulder tills, underlain by early Devonian mafic volcanic rock and late Ordovician marine clastics.

### 2.2. Wood Forwarding

Three GPS-tracking wood-forwarding machines were used: a John Deere 1510E forwarder in Blocks 1 and 2, a John Deere 1110E forwarder in Block 3, and a Tigercat 635D in Block 9 (**Table 3**). The resulting GPS data were processed to determine the number of passes per same track using point buffering and overlapping tools (Buja, 2012). Studies have shown that the number of wood-forwarding passes affects soil structure, compaction, and rut depth (Eliasson, 2005; Ampoorter et al., 2007; Farzaneh et al., 2012; Jones et al., 2018). Some studies have looked at mitigating multiple-pass soil rutting using brushmats (McDonald & Seixas, 1997; Labelle et al., 2015). Brushmats were not found along the forwarding trails in Blocks 3 and 9, but were present to varying degree in Blocks 1 and 2 as part of the commercial thinning operation. Studies have also shown that lower tire footprint areas due to increasing tire pressure increases rutting (Raper et al., 1995; Saarilahti & Anttila, 1999; Saarilahti, 2002b; Jun et al., 2004; Affleck, 2005; Sakai et al., 2008).

**Table 3.** Machine specifications (Jones et al., 2018).

| Machine Specs | JD11 Front | JD11 Rear | JD15 Front | JD15 Rear | TC Front | TC Rear |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Vehicle Weight ($\text{ton}/\text{kN}$) | $16.5/161.81$ | — | $17.3/169.66$ | — | $21.4/209.86$ | — |
| Full Load ($\text{ton}/\text{kN}$) | $11.0/107.87$ | — | $12.0/117.68$ | — | $15.0/147.10$ | — |
| Chassis Clearance ($\text{cm}$) | $60.0$ | — | $60.5$ | — | $63.5$ | — |
| Wheel Rim ($\text{cm}$) | $67.3$ | — | $67.3$ | — | $81.3$ | — |
| Number of Wheels | $4$ | $4$ | $4$ | $4$ | $2$ | $4$ |
| Tire type | 710/45-26.5 | — | 710/45-26.5 | — | 30.5Lx32 | 35.5Lx32 |
| Accessories | Chains | Tracks | Tracks | Tracks | Chains | Tracks |
| Diameter ($\text{cm}$) | $134.1$ | — | $134.1$ | — | $201.2$ | $184.4$ |
| Section Height ($\text{cm}$) | $33.4$ | — | $33.4$ | — | $51.6$ | $59.9$ |
| Width ($\text{cm}$) | $71.1$ | — | $71.1$ | — | $90.2$ | $77.5$ |
| Pressure ($\text{max, psi}$) | $32$ | — | $32$ | — | $32$ | — |

### 2.3. Data Sources

The data needed to process the temporal and spatial modelling of $MC$, $CI$, and soil rutting refer to:
1) Daily precipitation (snow and rain) and mean air temperature data, needed for the hydrological soil moisture calculations for Blocks 1-3 and Block 9. These data were obtained from the airport weather station records at Saint Leonard and Fredericton, respectively (Department of Environment and Climate Change Canada, 2016a).
2) Hydrometric stream discharge data, needed to calibrate ForHyM. These data were obtained for Blocks 1-3 from the nearby Black Brook Watershed Research Site (2014), and for Block 4 from the Nashwaaksis stream data (Department of Environment and Climate Change Canada, 2016b).
3) LiDAR-generated bare-earth elevation data. These were downloaded from geoNB's website at $1\text{ m}$ resolution (GeoNB, 2015).
4) Digital soil maps (DSM layers) for soil texture (sand, silt and clay content), bulk density, coarse fragments, and soil organic matter for top $30\text{ cm}$ of soil, at $10\text{ m}$ resolution (Furze, 2019).
5) GPS-recorded machine-clearance pattern, spaced at $10\text{ sec}$ intervals along each wood-forwarding track. The generation of these data was described by Jones et al. (2018).

### 2.4. Field Measurements

Soil samples as well as volumetric soil moisture ($MC_v$) and cone index ($CI$) readings were obtained from the top $15\text{ cm}$ layer of undisturbed mineral soil across Blocks 1 to 11 after wood forwarding (**Table 2**) in the fall of 2014, as described in Jones and Arp (2019). The samples were analyzed for texture (sand, silt and clay $\%$), coarse fragments ($\%$), organic matter content ($\%$), and bulk density ($\text{g/cm}^3$). Wood-forwarding rut depths were determined at GPS-recorded intervals along the tracks. The number of passes along the tracks were obtained from the GPS-tracked wood-forwarding machine-clearance records (Jones et al., 2018) through counting the number of passes per same track using digital point buffering and overlapping tools (Buja, 2012).

### 2.5. Soil Moisture Modelling

The Forest Hydrology Model ForHyM was used to estimate daily variations in pore-filled soil moisture content ($MC_{PS}$) on the well-drained soils in each block (**Appendix**). The $MC_{PS}$ output so generated served to determine how $MC_{PS}$ would have varied at the time of wood forwarding across the terrain of each block by way of season- and weather-adjusted cartographic depth-to-water ($DTW$) modelling (Murphy et al., 2009, 2011; White et al., 2012).

The cross-terrain $MC_{PS}$ projections were originally based on (Vega-Nieva et al., 2009; Jones & Arp, 2019):

$$MC_{PS,DTW} = 100 - [100 - MC_{PS,top}] \times \left[ \frac{1 - \exp(-k_{mc} DTW)}{1 - \exp(-k_{mc} DTW_{top})} \right]^{p_{mc}} \tag{1}$$

where $MC_{PS,top}$ refers to the pore-filled soil moisture content, $DTW_{top}$ refers to $DTW$ at the highest elevation in each block, $k_{mc}$ and $p_{mc}$ are block-specific calibration parameters, with $MC_{PS,DTW} = 100\%$ along water-filled flow channels where $DTW = 0\text{ m}$. The $MC_{PS,DTW}$ projections inside and outside wood-forwarding tracks were augmented via multiple regression analysis to account for changes in elevation, forest cover type (hardwoods, softwood, open areas), and soil organic matter content ($OM_{DSM}$) as follows:

$$MC_{PS} = 70.88 + 0.26 MC_{PS,DTW} - 2.76 \log_{10} DTW_{FIA} - 0.98 OM_{DSM} - 0.10 DEM + 10.22 HW + 4.09 Track; \quad R^2 = 0.46 \tag{2}$$

with $\log_{10} DTW_{FIA}$ referring to the logarithm of the rasterized depth-to-water index adjusted to the upslope flow initiation area ($FIA$) at the time of wood forwarding. In addition, $OM_{DSM}$ is the digitally derived soil organic matter raster (Furze, 2018; in $\%$), $DEM$ is elevation in meters, $Track = 1$ for ruts and $0$ otherwise, and $HW = 1$ refers to locations dominated by hardwood, otherwise $HW = 0$. The values of model parameters required for Equations (1) and (2) are listed in **Table 4**.

### 2.6. Cone Index and Rut Depth Modelling

Rut locations and depths were GPS tracked and measured in the fall of 2014 immediately after wood forwarding, as listed in **Table 2**. Volumetric soil moisture, bulk density ($D_b$) and cone penetration measurements were obtained prior to these operations (Jones & Arp, 2019). Once $MC_{PS}$ was rasterized via Equation (2), $CI$ (in $\text{MPa}$) and $NCI$ were emulated using the following expressions (Jones & Arp, 2019):

$$CI = 1.60 - 0.01 MC_{PS} + 0.03 Depth + 0.76 Track + 0.40 SW; \quad R^2 = 0.41 \tag{3}$$

where $Depth$ is soil depth ($\text{cm}$), $Track = 1$ signifies presence of track with $Track = 0$ for undisturbed soil, and $SW = 1$ signifies where softwoods are dominant, otherwise $SW = 0$. The normalized cone index $NCI$ (dimensionless) was derived from:

$$NCI = \frac{1000 CI d b}{W} \sqrt{\frac{\delta}{h}} \frac{1}{1 + b / (2d)} \tag{4}$$

with $d$ as tire diameter ($\text{m}$), $b$ as tire width ($\text{m}$), $W$ as total wheel load ($\text{kN}$) given by $(\text{machine weight} + \text{load}) / \text{number of tires}$, $h$ as section height of the tire ($\text{m}$), and $\delta = 0.001(0.365 + 170/p)W$ as tire deflection, with $p$ as tire inflation pressure (in $\text{kPa}$).

Relating rut depth to $NCI$ and number of passes along the same track produced the following regression equation:

$$Z = \frac{40.8}{NCI_{adj}} \times Passes^{0.071 \times NCI_{adj}}; \quad R^2 = 0.32 \tag{5}$$

where $Z$ is best-fitted field-measured rut depth, and where $NCI_{adj} = (NCI + 0.48 DTW_{FIA})$ incorporates a further numerically derived block-by-block $DTW$ adjustment.

**Table 4.** $DTW_{FIA}$ and $MC_{PS,top}$ specifications for Blocks 1, 2, 3, and 9 at the time of wood forwarding.

| Block | $DTW_{FIA}$ ($\text{ha}$) | $MC_{PS,top}$ ($\%$) |
| :---: | :---: | :---: |
| 1 | 1 | 39.9 |
| 2 | 16 | 35.3 |
| 3 | 1 | 39.4 |
| 9 | 0.25 | 26.4 |

### 2.7. Statistical Analyses

All analyses were performed in R (R Core Team, 2015) after combining the rasterized data layers into a covariate stack. A correlation matrix was created to show the general association pattern between the covariates, and the covariate association pattern so revealed was factor analysed. This was followed by modelling $MC_{PS}$, $CI$, and $Z_n$ using multiple and Random Forest regression formulations (Breiman, 2001).

The dataset for modelling $MC_{PS}$ ($n = 394$) and $CI$ ($n = 372$) included all top $15\text{ cm}$ soil sampling locations inside and outside the tracks in Blocks 1 to 11. The dataset for modelling rut depth ($n = 207$) applied to Blocks 1, 2, 3, and 9 only. The multivariate regression (MR) formulation via Equations (2) to (5) served to explore the extent of functional dependence of $MC_{PS}$, $CI$, and $Z_n$ on weather, season, machine type, and digital soil mapping layers. The required input for modelling $MC_{PS}$ via Equation (2) refers to $MC_{PS,DTW}$ (Equation (1)), $\log_{10} DTW$, $OM_{DSM}$, $DEM$, $HW = 1$ or $0$, and $Track = 0$ or $1$. The required input for modelling $CI$ via Equation (3) refers to modelled $MC_{PS}$, $Depth$, $SW = 1$ or $0$, and $Track = 0$ or $1$. The required input for rut depth modelling via Equation (5) refers to modelled $NCI$ and number of passes.

MR and RF inputs comprised $NCI$ (Equation (4)), $CF_{DSM}$, $OM_{DSM}$, depth to C horizon ($C_{DSM}$), and number of passes ("Passes"). The training process was set to generate and test 15 regression trees using 3 variables to split each tree node, followed by a 10-fold cross-validation process with 10 replicates (Kohavi, 1995). The resulting model output produced field-determined versus Random-Forest fitted $MC_{PS}$, $CI$, and $Z_n$ scatter plots, and informed about the most $MC_{PS}$-, $CI$-, and $Z_n$-predictive data layers. RF model performance was determined by evaluating the mean decreased accuracy and variable importance.

Both MR and RF techniques were used to determine which combination of variables would produce the best-fitting $MC_{PS}$, $CI$, $NCI$ and rut depth projections. With best-fitted results reported by listing the number of variables used, the root mean square error ($RMSE$), and the coefficient of determination $R^2$.

### 2.8. Soil Trafficability Model (STRAM)

The information flow generated from modelling soil moisture, $CI$ and rut depth was organized in the form of a Soil Trafficability Model framework (STRAM), as shown in **Figure 3**. Applying STRAM involved:
1) Initializing and calibrating ForHyM to determine $MC_{PS}$ for specific weather conditions, by block and stand type.
2) Projecting $MC_{PS}$ across the terrain based on digital elevation, $DTW$, and soil mapping techniques, by block, using Equation (2).
3) Combining the weather-specific $MC_{PS}$ projections with digitally generated soil properties to generate the $CI$, $NCI$ and rut-depth data layers, by block, using Equations (3) to (5).
4) Optimizing these data layers through R-tool regression techniques (fixed effects, Random Forest) based on actual field observations where available.

*(Figure 3: Flowchart for generating the rut depth raster for Block 3.)*

---

## 3. Results

### 3.1. $MC_{PS}$, $CI$, and Rut-Depth Analysis

The basic statistics of the plot-centered rut depth, $MC_{PS}$, $CF_{DSM}$, $Sand_{DSM}$, $OM_{DSM}$, $D_{b,DSM}$, $C_{DSM}$, elevation, $DTW$, $CI$, and $NCI$ values are listed in **Table 5**. The correlation coefficients and their non-zero significance levels between these variations in association with block location are compiled in **Table 6**, along with the corresponding factor analysis. Factor 1 indicates that the rut-depth determinations related positively to number of wood-forwarding passes, to sand and organic matter content, and to soil depth ($C_{DSM}$), but negatively to $NCI$, as to be expected. In addition, rut depth was generally deeper in hardwood blocks (Blocks 3 and 9). Factor 2 reflects that the hardwood blocks at higher elevation and $DTW$ locations had lower soil density and hence lower soil resistance to penetration than the softwood blocks located at lower elevations.

**Table 5.** Soil physical properties and rut measurements.

| Block | Stat | $Sand_{DSM}$ ($\%$) | $OM_{DSM}$ ($\%$) | $CF_{DSM}$ ($\%$) | $D_{b,DSM}$ ($\text{g/cm}^3$) | $C_{DSM}$ ($\text{cm}$) | Elevation ($\text{m}$) | $DTW_{FIA}$ ($\text{m}$) | $MC_{PS}$ ($\%$) | $CI$ ($\text{MPa}$) | $NCI$ | Passes ($\#$) | Rut Depth ($\text{cm}$) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1**<br>$n = 29$ | Mean | 40.41 | 6.45 | 26.21 | 0.96 | 38.09 | 277.86 | 1.44 | 64.07 | 2.41 | 4.84 | 4.62 | 15.62 |
| | Min | 32.31 | 5.30 | 21.90 | 0.90 | 33.97 | 275.73 | 0.00 | 48.54 | 1.90 | 3.82 | 2.00 | 5.50 |
| | Max | 44.75 | 7.53 | 32.16 | 1.10 | 43.86 | 280.49 | 3.54 | 74.38 | 3.00 | 6.02 | 10.00 | 32.50 |
| | SD | 2.62 | 0.75 | 2.67 | 0.04 | 2.63 | 1.31 | 1.14 | 7.71 | 0.30 | 0.60 | 1.52 | 6.65 |
| **2**<br>$n = 40$ | Mean | 46.16 | 5.86 | 35.80 | 0.99 | 39.98 | 261.33 | 2.17 | 65.75 | 1.93 | 3.87 | 5.75 | 13.29 |
| | Min | 36.01 | 4.63 | 27.04 | 0.80 | 34.43 | 258.07 | 0.04 | 46.31 | 1.56 | 3.13 | 2.00 | 2.50 |
| | Max | 55.42 | 8.54 | 48.14 | 1.11 | 47.29 | 266.48 | 7.26 | 82.88 | 2.42 | 4.87 | 8.00 | 40.00 |
| | SD | 4.67 | 1.02 | 6.01 | 0.07 | 2.63 | 2.11 | 1.81 | 9.70 | 0.24 | 0.48 | 1.51 | 10.53 |
| **3**<br>$n = 75$ | Mean | 43.90 | 6.40 | 33.86 | 0.79 | 39.92 | 360.05 | 1.18 | 65.37 | 1.84 | 3.57 | 3.57 | 13.91 |
| | Min | 36.26 | 4.41 | 21.23 | 0.63 | 33.78 | 345.73 | 0.09 | 47.88 | 1.51 | 2.94 | 2.00 | 0.50 |
| | Max | 51.36 | 11.50 | 44.06 | 0.97 | 50.42 | 365.91 | 4.51 | 83.71 | 2.33 | 4.54 | 15.00 | 32.00 |
| | SD | 3.67 | 1.29 | 5.22 | 0.08 | 3.06 | 4.17 | 0.99 | 6.77 | 0.19 | 0.37 | 2.67 | 8.11 |
| **9**<br>$n = 63$ | Mean | 54.09 | 10.00 | 33.65 | 0.99 | 41.78 | 275.67 | 1.05 | 69.75 | 2.03 | 3.18 | 18.03 | 22.54 |
| | Min | 41.93 | 7.86 | 22.52 | 0.81 | 36.35 | 266.39 | 0.01 | 46.36 | 1.59 | 2.48 | 2.00 | 0.00 |
| | Max | 65.16 | 13.30 | 42.84 | 1.20 | 49.57 | 282.96 | 3.12 | 83.85 | 2.63 | 4.12 | 80.00 | 60.00 |
| | SD | 4.89 | 1.10 | 4.10 | 0.08 | 2.68 | 4.27 | 0.83 | 9.19 | 0.27 | 0.42 | 22.91 | 13.07 |

**Table 6.** Pearson's correlation matrix (below diagonal) with significance levels (above diagonal) for each variable pair, and Factor analysis loadings for Factor 1 and 2 following oblique factor rotation.

| Variable | Rut Depth | Passes | $NCI$ | $CF_{DSM}$ | $Sand_{DSM}$ | $OM_{DSM}$ | $D_{b,DSM}$ | $C_{DSM}$ | Elevation | $DTW_{FIA}$ | HW Blocks | Factor 1 | Factor 2 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Rut Depth ($\text{cm}$)** | $1.000$ | $<0.0001$ | $<0.0001$ | $0.6155$ | $<0.0001$ | $<0.0001$ | $0.0061$ | $0.2369$ | $0.0171$ | $0.0093$ | $0.0247$ | $0.536$ | $-0.011$ |
| **Passes ($\#$)** | $0.470$ | $1.000$ | $0.0048$ | $0.8253$ | $<0.0001$ | $<0.0001$ | $<0.0001$ | $0.0011$ | $0.0011$ | $0.0876$ | $0.0189$ | $0.622$ | $-0.117$ |
| **$NCI$** | $-0.228$ | $-0.195$ | $1.000$ | $<0.0001$ | $<0.0001$ | $<0.0001$ | $0.5304$ | $<0.0001$ | $0.0845$ | $0.0016$ | $<0.0001$ | $-0.682$ | $-0.284$ |
| **$CF_{DSM}$ ($\%$)** | $-0.035$ | $-0.015$ | $-0.321$ | $1.000$ | $<0.0001$ | $0.0979$ | $0.8540$ | $0.0062$ | $0.4404$ | $0.5240$ | $0.0147$ | $0.298$ | $0.234$ |
| **$Sand_{DSM}$ ($\%$)** | $0.305$ | $0.424$ | $-0.596$ | $0.228$ | $1.000$ | $<0.0001$ | $<0.0001$ | $<0.0001$ | $<0.0001$ | $0.0860$ | $<0.0001$ | $0.836$ | $0.034$ |
| **$OM_{DSM}$ ($\%$)** | $0.304$ | $0.453$ | $-0.389$ | $0.115$ | $0.569$ | $1.000$ | $<0.0001$ | $<0.0001$ | $<0.0001$ | $0.0201$ | $<0.0001$ | $0.793$ | $0.072$ |
| **$D_{b,DSM}$ ($\text{g/cm}^3$)** | $0.190$ | $0.321$ | $0.044$ | $0.013$ | $0.365$ | $0.312$ | $1.000$ | $0.0093$ | $<0.0001$ | $0.4840$ | $<0.0001$ | $0.347$ | $-0.742$ |
| **$C_{DSM}$ ($\text{cm}$)** | $0.083$ | $0.225$ | $-0.252$ | $0.190$ | $0.355$ | $0.323$ | $0.180$ | $1.000$ | $0.2901$ | $0.6515$ | $<0.0001$ | $0.514$ | $0.107$ |
| **Elevation ($\text{m}$)** | $-0.166$ | $-0.224$ | $-0.120$ | $0.054$ | $-0.333$ | $-0.301$ | $-0.780$ | $-0.074$ | $1.000$ | $0.0483$ | $<0.0001$ | $-0.208$ | $0.873$ |
| **$DTW_{FIA}$ ($\text{m}$)** | $0.180$ | $-0.011$ | $0.217$ | $0.045$ | $-0.120$ | $-0.160$ | $0.049$ | $0.032$ | $-0.137$ | $1.000$ | $<0.0001$ | $-0.312$ | $-0.388$ |
| **HW Block** | $0.156$ | $0.163$ | $-0.601$ | $0.170$ | $0.350$ | $0.442$ | $-0.367$ | $0.247$ | $0.585$ | $-0.283$ | $1.000$ | $0.578$ | $0.870$ |

The MR-generated results in **Table 7** revealed that $MC_{PS}$ increased significantly with $MC_{PS,DTW}$ as influenced by wet weather and by decreasing $DTW$ from ridge tops to low-lying areas next to water-filled flow channels. In addition, $MC_{PS}$ was higher inside than outside the tracks, and higher under hardwood vegetation but decreased towards the higher elevation blocks (**Table 7**). $CI$ decreased with increasing pore-filled soil moisture content, but was noticeably higher within softwood blocks and tracks due to cumulative wheel-induced compaction. As per Equation (5), rut depth increased significantly with number of forwarding passes ($\log_{10} Passes$) and decreased significantly with increasing $\log_{10} NCI$. The non-linear $DTW$-adjustment for Equation (
    
) improved the MR regression results and related best-fitted scatterplots, but only to a small extent.

The RF results, also listed in **Table 7**, identified $MC_{PS,DTW}$, elevation ($DEM$) and $OM_{DSM}$ as dominant $MC_{PS}$ influencing predictors. For $CI$, RF selected elevation, $MC_{PS}$, $Sand_{DSM}$, $Depth$, and track location as dominant predictors. For rut depth, the RF process selected number of passes, $NCI$, $DTW$ and $CF$ as best predictors.

Compared to MR, the best-fitted RF-generated $R^2$ values for $MC_{PS}$, $CI$ and rut depth in **Table 7** were considerably higher. The corresponding scatter plots in **Figure 4** demonstrate the extent of the MR- versus RF-generated goodness-of-fit for each of these variables. In detail, the eight-times-out-of-ten conformance levels for $MC_{PS}$, $CI$ and rut depth respectively amounted to: $\pm 14\%$, $\pm 0.7\text{ MPa}$ and $\pm 14\text{ cm}$ for MR, and $\pm 4\%$, $\pm 0.3\text{ MPa}$, and $\pm 4\text{ cm}$ for RF (**Figure 5**).

**Table 7.** Multiple and Random Forest regression results for $MC_{PS}$, $CI$ and rut depth.

#### Multiple Regression (MR)

| Dependent variables | Intercept & predictor variables | Parameter # | Regr. | $\pm \text{SE}$ | $t$-value | $p$-value | $R^2$ | $RMSE$ | $n$ |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **$MC_{PS}$ ($\%$)**<br>Equation (2) | Intercept | | $70.883$ | $6.326$ | $11.205$ | $<0.0001$ | $0.47$ | $11.69$ | $394$ |
| | Elevation | 1 | $-0.091$ | $0.013$ | $-6.937$ | $<0.0001$ | | | |
| | HW Blocks | 2 | $10.224$ | $2.136$ | $4.788$ | $<0.0001$ | | | |
| | $MC_{PS,DTW}$ | 3 | $0.262$ | $0.073$ | $3.589$ | $0.0003$ | | | |
| | $OM_{DSM}$ | 4 | $-0.981$ | $0.278$ | $-3.529$ | $0.0005$ | | | |
| | Tracks | 5 | $4.090$ | $1.233$ | $3.316$ | $0.001$ | | | |
| | $\log_{10} DTW$ | 6 | $-2.764$ | $0.926$ | $-2.986$ | $0.003$ | | | |
| **$CI$ ($\text{MPa}$)**<br>Equation (3) | Intercept | | $1.599$ | $0.159$ | $10.06$ | $<0.0001$ | $0.41$ | $0.571$ | $372$ |
| | Tracks | 1 | $0.760$ | $0.064$ | $11.91$ | $<0.0001$ | | | |
| | SW Blocks | 2 | $0.397$ | $0.064$ | $6.20$ | $<0.0001$ | | | |
| | $MC_{PS}$ | 3 | $-0.011$ | $0.002$ | $-5.98$ | $<0.0001$ | | | |
| | Depth | 4 | $0.025$ | $0.002$ | $9.90$ | $0.0583$ | | | |
| **Rut depth ($\text{cm}$)**<br>Linear Log Model | Intercept | | $18.880$ | $6.592$ | $2.864$ | $0.0004$ | $0.28$ | $9.094$ | $207$ |
| | $\log_{10} Passes$ | 1 | $14.327$ | $1.856$ | $7.721$ | $<0.0001$ | | | |
| | $\log_{10} NCI$ | 2 | $-22.213$ | $10.625$ | $-2.091$ | $0.038$ | | | |
| | $\log_{10} DTW_{FIA}$ | 3 | $-2.669$ | $1.071$ | $-2.492$ | $0.014$ | | | |
| **Equation (5)** | $(a / NCI_{adj}) \times Passes^{b \cdot NCI_{adj}}$ | | | | | | $0.32$ | $9.000$ | $207$ |
| | $a$ | | $40.886$ | $3.275$ | $12.728$ | $<0.0001$ | | | |
| | $b$ | | $0.072$ | $0.007$ | $9.676$ | $<0.0001$ | | | |

#### Random Forest (RF)

| Dependent variables | Variable | Parameter # | $\%$ Mean Decrease Accuracy | Variable Importance | $R^2$ | $RMSE$ | $n$ |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **$MC_{PS}$ ($\%$)** | $MC_{PS,DTW}$ | 1 | $191.04$ | $53332.12$ | $0.91$ | $4.962$ | $394$ |
| | Elevation | 2 | $180.54$ | $32079.21$ | | | |
| | $OM_{DSM}$ | 3 | $38.17$ | $16292.63$ | | | |
| **$CI$ ($\text{MPa}$)** | Tracks | 1 | $0.224$ | $33.20$ | $0.88$ | $0.263$ | $372$ |
| | Depth | 2 | $0.159$ | $37.43$ | | | |
| | Elevation | 3 | $0.108$ | $49.27$ | | | |
| | $MC_{PS,RF}$ | 4 | $0.097$ | $47.64$ | | | |
| | $Sand_{DSM}$ | 5 | $0.070$ | $36.86$ | | | |
| **Rut depth ($\text{cm}$)** | Passes | 1 | $71.77$ | $7121.22$ | $0.84$ | $4.307$ | $207$ |
| | $NCI_{RF}$ | 2 | $24.26$ | $5744.51$ | | | |
| | $DTW_{FIA}$ | 3 | $11.35$ | $5971.05$ | | | |
| | $CF$ | 4 | $0.65$ | $3813.68$ | | | |

*(Figure 4: Comparison between modelled linear regression and random forest for $MC_{PS}$, $CI$ and rut depth.)*

*(Figure 5: Cumulative conformance probability for differences in $MC_{PS}$, $CI$, and rut depth for RF and RM.)*

*(Figure 6: Best-fitted RF- and MR-$R^2$ and $RMSE$ values achieved using predictor variables in the order of decreasing numerical significance or influence.)*

The successive inclusion of additional predictor variables from most to the least significant was characterized by diminishing conformance gains, as shown in **Figure 6**. Using only one continuous predictor variable for $MC_{PS}$ led to an RF-$R^2$ gain of about $0.80$, while the corresponding MR-$R^2$ gain was limited to $0.2$. For $CI$ and rut depth, MR and RF had similar low initial $R^2$ values using, respectively, the binary $0, 1$ $Track$ and the grouped number of passes ("Passes") variables. Having these variables as initial predictor variables was essential to address the otherwise unresolvable scatter that would otherwise be incurred by using continuous predictor variables only.

**Figure 7** shows the GPS-tracked wood forwarding tracks across Blocks 1, 2, 3, and 9 overlaid on the delineated $DTW < 1\text{ m}$ and hill-shaded $DEM$ background; also shown are the number of passes (top) and field-measured rut depths (bottom) at each location (**Figure 7**). Among these blocks, Block 3 revealed a close association between deep rut depths and $DTW$, followed by Block 9 and Block 2. Block 1 had no association between rut-depth and pass number. Rutting was deepest in Blocks 3 and 9 along multi-pass tracks across streams and wet-areas.

**Figure 8** provides a closer look regarding the extent of track rutting in Block 9 through the overlays of the $DTW < 0.5\text{ m}$ delineated patterns on the hill-shaded $DEM$ (top) and the surface-image (bottom) backgrounds. The surface image was generated a year after the wood-forwarding operations. At that time, rutting appearances had faded but remained prominent in the lower left corner of Block 9. Rutting $> 40\text{ cm}$ deep occurred along multiple pass tracks where $DTW < 0.5\text{ m}$.

*(Figure 7: Field-measured rut-depth locations with number of passes along rut tracks (top) and rut depth (bottom) across Blocks 1, 2, 3 and 9, also shown are the block-specific weather-affected $DTW_{FIA}$ assignments, i.e. $FIA = 1, 16, 1, 0.25$, respectively.)*

*(Figure 8: Close-ups from Figure 7 showing rut-depth measurement locations in Block 9 in relation to the extent of $DTW < 0.5\text{ m}$ outline overlaid on a hill-shaded $DEM$ (top, $10\text{ cm}$ resolution) obtained from DJI Phantom 4 Pro high-resolution surface scanning, imaging and processing (bottom) one year after field operations.)*

### 3.2. $MC_{PS}$, $CI$, and Rut-Depth Projections

**Figure 9** presents the MR- and RF-generated projections and data points for $MC_{PS}$ (top) and $CI$ (bottom) for Blocks 1, 2, 3, and 9, with RF projections more detailed in appearance and conformance than the MR projections, as to be expected from the scatter plots in **Figure 4**, and the results listed in **Table 7**. Among the blocks, Block 9 proved to be the wettest, on account of a $70\text{ mm}$ rain event two days prior to the day of wood forwarding, and as reflected by the consequential use of the $DTW_{FIA} = 0.25\text{ ha}$ data layer as dominant $MC_{PS}$ predictor via Equation (2). In contrast, Block 1 was found to be excessively dry, such that the $DTW_{FIA} = 16\text{ ha}$ projection was best to represent the field-determined $MC_{PS}$ values for this block outside the tracks. For Blocks 2 and 3, the $MC_{PS}$ was best presented using the $DTW_{FIA} = 1\text{ ha}$ assignment to reflect the May and June soil moisture conditions at the time of wood forwarding. Although both blocks had the same $DTW_{FIA} = 1\text{ ha}$ assignment, they differed in terms of $CI$-measured soil strength which was determined to be weaker for the hardwood block (Block 3) than for the softwood block (Block 2). Typically, shallow-rooting softwood forests grow on coarser and stonier soils with lower soil organic matter accumulations than deeper-rooted hardwood forests.

**Figure 10** presents an overlay of rut depth points on the corresponding MR (top) and RF (bottom) projections for Blocks 1, 2, 3, and 9 after 1, 10 and 50 passes, with better and more resolved RF than MR data-to-projection conformances. These plots confirm that number of passes and spatial variations in soil moisture are important rut-depth predictor variables. Actual rut depth, however, also depends on machine weight/load and soil physical properties, as quantified by way of $CI$, $NCI$, and the variables listed in **Table 7**.

*(Figure 9: Measured $MC_{PS}$ and $CI$ values at $15\text{ cm}$ soil depth overlaid on the corresponding Equation (2) and Equation (3) map projections for Blocks 1, 2, 3 and 9, using $FIA = 1, 16, 1, 0.25$, respectively.)*

*(Figure 10: Random Forest modelled 2- and 10-pass rut depths for Blocks 1, 2, 3, 9 with machines carrying full loads, with the field plot determinations overlaid, using $FIA = 1, 16, 1, 0.25$, respectively.)*

---

## 4. Discussion

While RF emulates field-measured values for $MC_{PS}$, $CI$ and rut depth considerably better than best-fitted MR values, it can only do so by systematically tracking those variables that best account for the overall data variations, including outliers. To be of general value, more testing is required to capture more of the $MC_{PS}$, $CI$ and rut depth variations across a wide range of soil and vegetation conditions. In this regard, the above regression results are at least consistent with general expectations. For example, moist to wet soils have low physical strength due to low particle cohesion (Kumar et al., 2012), and are therefore prone to traffic-induced compaction, displacement and rutting (Sutherland, 2003; Børgesen et al., 2006; Nikooy et al., 2016; Jones & Arp, 2017). To illustrate, Block 3 shows deeper ruts within the wetter $DTW_{FIA} = 1\text{ ha}$ marked area next to a stream. Block 1 with no significant rut-depth observations was cut following dry weather conditions during mid-June of 2014, with overall soil moisture levels best conforming to a $DTW_{FIA} = 16\text{ ha}$ flow-channel pattern. In contrast, deep ruts were encountered across Block 9 due to field operations in October 2014 following a $70\text{ mm}$ heavy rain event.

In terms of other physical soil properties, studies have shown that measured rut depth correlates positively with increased levels of $OM$ in the soil (Sutherland, 2003; McFero Grace et al., 2006). In this study, rut depth also correlated positively with $OM$ in Block 9 as revealed by the factor analysis results shown in **Table 6**.

Increased sand content generally contributes to low $CI$, $NCI$ and therefore to increased rut depth, mainly due to low particle-to-particle cohesion (Balland et al., 2008; Brady & Weil, 2008; Kumar et al., 2012). In contrast, high coarse fragment content would increase $CI$, thereby decreasing rut depths. However, the overall $CF$ variations within and across the blocks did not register this effect by way of MR, and only weakly so by RF. Typically, soils with high soil strength (high $CI$ and $NCI$ values) minimize soil disturbance (Antille & Godwin, 2013).

Significant and influential on the MR and RF results was the dependence of rut depth on the number of passes ($p < 0.0001$). In detail, this effect decreased non-linearly with increasing pass number due to gradually increasing soil compaction, as quantified above via Equation (5) and in conformance with Eliasson (2005), Eliasson and Wästerlund (2007), Botta et al. (2009) and Jones et al. (2018). This is especially so for high traffic areas such as wood landing sites, and along tracks involving a hundred passes or more (Carter et al., 2007; Taghavifar & Mardani, 2014; Jones et al., 2018).

Given the above moderate (MR) and strong (RF) data-to-projection conformances, it should be possible—at least in general—to project and forecast soil trafficability by following the flowchart given in **Figure 3**. Fundamental to doing this is the combining of preceding and forecasted weather conditions (**Appendix**) with digital soil mapping. To this effect, **Figure 11** provides a summary of daily summer through winter weather conditions for Block 1 for a period of 14 years. Generally, soil trafficability within this block would be best on solidly frozen ground, but worst during snowmelt periods when soils tend to be equally wet and partially thawed across the land. In detail, April and November would be the wettest months (**Figure 11**). During spring, summer and fall, soil trafficability would vary by monthly variations in soil moisture, and by the reduction thereof through evapotranspiration, as primarily affected by precipitation, air temperatures and canopy leaf area. According to **Figure 11**, the driest summer occurred in 2005 followed by the wettest fall. The wettest summers occurred in 2003 and 2011. Soil trafficability would also have been very poor in April 2005. In contrast, soil trafficability would have been best during the winters of 2004, 2011, 2013 and 2014 due to deep and prolonged snowpack and soil frost conditions.

*(Figure 11: Historical weather for Block 1 from 2000 to 2015 showing cumulative precipitation (bottom left), historical snowpack and modelled frost depth (top left), mean January, July, and annual air temperatures (top right), and mean ForHyM-modelled $MC_{PS}$ per week (bottom right).)*

For the spatial component of the soil trafficability projections, it is important to determine the likely upslope flow-channel initiation area for each block, as listed in **Table 8**. To some extent, these estimates would need to be modified by soil texture and coarse fragment content: $FIA$ numbers should be higher for well drained and rocky soils, and lower for loamy and clayey soils. Extended droughts and frost periods would also increase $FIA$, therefore increasing the areas available for off-road traffic. However, even during winter, care needs to be given to not drive along or across flow channels with high upslope flow-accumulation areas. This care is needed because: 1) channels may not totally be frozen on account of upwelling seepage water, and 2) soil compaction and rutting along and across the channels would not only aggravate subsequent flooding but also soil and stream bank erosion. An example of year-round soil trafficability forecasting by month and related weather-imposed $DTW_{FIA}$ assignments is provided in **Figure 12**, with a focus on likely rut depths to be incurred by two wood-forwarding passes.

*(Figure 12: Year-round RF-generated soil trafficability projections by month for Block 1, with focus on 2 passes and 2014 weather-affected $DTW_{FIA}$ assignments.)*

**Table 8.** Monthly region-specific $DTW_{FIA}$ choices useful for forecasting soil trafficability across Blocks 1, 2, 3, and 9 and northwestern New Brunswick in general.

| Month | $8\text{ ha}$ | $4\text{ ha}$ | $1\text{ ha}$ | $0.25\text{ ha}$ |
| :--- | :---: | :---: | :---: | :---: |
| **January** | Frozen | | | Partial Thaw |
| **February** | Frozen | | | Partial Thaw |
| **March** | Frozen | | | Partial Thaw |
| **April** | Frozen | | | Very Wet |
| **May** | Very Dry | Dry | | Very Wet |
| **June** | Very Dry | Dry | Moist | Wet |
| **July** | Very Dry | Dry | Moist | Wet |
| **August** | Very Dry | Dry | Moist | Wet |
| **September** | Very Dry | Dry | Wet | Moist |
| **October** | | Dry | Wet | Moist |
| **November** | | Dry | Moist | Wet |
| **December** | Frozen | Dry | Moist | Wet |

Perhaps the greatest impediment for correct soil trafficability forecasting is the lack of proper coarse fragment specifications, which should—ideally—represent total $CF$ changes within and across soils. The $CF$ data and data layers used for this purpose were, however, not revealed to be significant within- and across-block predictor variables for $MC_{PS}$, $CI$ and rut depth. In part, this was due to not including coarse fragments larger than gravel size in the soil sampling process. However, where such sampling is sufficient, the following formulation for $CI$ may serve as a general non-block specific $CI$ predictor (Jones & Arp, 2017):

$$\log_{10} CI = 0.26 - 0.29 \times PS - 0.41 \times MC_{PS} + 1.04 \times CF; \quad R^2 = 0.54 \tag{6}$$

where data for total coarse fragment content per soil volume are available, rut projections need to be forced towards zero when $CF$ approaches $1$. This can be done by, e.g., adjusting Equation (5) to:

$$Z = \frac{40.8}{NCI_{adj}} \times Passes^{0.071 \times NCI_{adj}} \times (1 - CF)^2 \tag{7}$$

---

## 5. Concluding Remarks

While this research demonstrates that the STRAM approach can be used to assess and project soil trafficability through coupling block-based soil surveys with temporal and spatial modelling techniques, there is a need for further data layer improvements using MR and RF modeling techniques. To this end, area-systematic rut surveys can now be conducted by, e.g., equipping off-road vehicles with GPS-tracking LiDAR-based rut depth sensors (Salmivaara et al., 2018). Similarly, Giannetti et al. (2017) proposed terrestrial portable laser scanners and Haas et al. (2016), Pierzchała et al. (2016) and Launiainen et al. (2017) used unmanned airborne vehicles (UAVs) for rut-depth stereo imaging and evaluating underlying terrain conditions. In addition, advances in weather-affected digital soil property mapping will further assist soil trafficability mapping, and the validity of the same needs to be assessed systematically using area-wide post-operational rut-depth surveys. In this regard, MR and RF techniques will be helpful in terms of determining how operationally induced soil compaction and rutting as observed and projected vary by topographic location, season and weather.

---

## Acknowledgements

This research was supported financially through an NSERC Collaborative Research Project with J.D. Irving Limited as industrial partner. Special thanks go to Forest Watershed Research Centre at UNB, for facilitating this research, with additional support from Doug Hiltz for assistance with field sampling, and from Dr. Shane Furze for RF-analysis assistance and $10\text{ m}$ DSM layer provisions.

## Conflicts of Interest

The authors declare no conflicts of interest regarding the publication of this paper.

---

## References

* Affleck, R. T. (2005). *Disturbance Measurements from Off-Road Vehicles on Seasonal Terrain*. US Army Corps of Engineers, Engineer Research and Development Center, Cold Regions Research and Engineering Laboratory.
* Alberta Forest Products Association (1994). *Forest Soils Conservation Guidelines*.
* Ampoorter, E., Goris, R., Cornelis, W. M., & Verheyen, K. (2007). Impact of Mechanized Logging on Compaction Status of Sandy Forest Soils. *Forest Ecology and Management*, 241, 162-174. https://doi.org/10.1016/j.foreco.2007.01.019
* Antille, D. L., & Godwin, R. J. (2013). Soil Displacement and Soil Bulk Density Changes as Affected by Tire Size. *Transactions of the ASABE*, 56, 1683-1693. https://doi.org/10.13031/trans.56.9886
* Arp, P. A., & Yin, X. (1992). Predicting Water Fluxes through Forest from Monthly Precipitation and Mean Monthly Air Temperature Record. *Canadian Journal of Forest Research*, 22, 864-877. https://doi.org/10.1139/x92-116
* Balland, V., Pollacco, J. A. P., & Arp, P. A. (2008). Modeling Soil Hydraulic Properties for a Wide Range of Soil Conditions. *Ecological Modelling*, 219, 300-316. https://doi.org/10.1016/j.ecolmodel.2008.07.009
* Bassett, I. E., Simcock, R. C., & Mitchell, N. D. (2005). Consequences of Soil Compaction for Seedling Establishment: Implications for Natural Regeneration and Restoration. *Austral Ecology*, 30, 827-833. https://doi.org/10.1111/j.1442-9993.2005.01525.x
* Black Brook Watershed Research Site (2014). *Black Brook Watershed Stream Discharge Data* (WWW Document).
* Børgesen, C. D., Jacobsen, O. H., Hansen, S., & Schaap, M. G. (2006). Soil Hydraulic Properties near Saturation, an Improved Conductivity Model. *Journal of Hydrology*, 324, 40-50. https://doi.org/10.1016/j.jhydrol.2005.09.014
* Botta, G. F., Becerra, A. T., & Tourn, F. B. (2009). Effect of the Number of Tractor Passes on Soil Rut Depth and Compaction in Two Tillage Regimes. *Soil and Tillage Research*, 103, 381-386. https://doi.org/10.1016/j.still.2008.12.002
* Brady, N. C., & Weil, R. R. (2008). *The Nature and Properties of Soils* (14th ed.). Upper Saddle River, NJ: Prentice Hall.
* Breiman, L. (2001). Random Forests. *Machine Learning*, 45, 5-32. https://doi.org/10.1023/A:1010933404324
* Buja, K. (2012). *Finding Overlapping Features Tool for ArcGIS*.
* Carter, E. A., Aust, W. M., & Burger, J. A. (2007). Soil Strength Response of Select Soil Disturbance Classes on a Wet Pine Flat in South Carolina. *Forest Ecology and Management*, 247, 131-139. https://doi.org/10.1016/j.foreco.2007.04.026
* Chen, G., & Weil, R. R. (2011). Root Growth and Yield of Maize as Affected by Soil Compaction and Cover Crops. *Soil and Tillage Research*, 117, 17-27. https://doi.org/10.1016/j.still.2011.08.001
* Department of Environment and Climate Change Canada (2016a). *Historical Climate Data* (WWW Document). http://climate.weather.gc.ca/
* Department of Environment and Climate Change Canada (2016b). *Historical Hydrometric Data* (WWW Document). http://wateroffice.ec.gc.ca/
* Dexter, A. R., Czyż, E. A., & Gate, O. P. (2007). A Method for Prediction of Soil Penetration Resistance. *Soil and Tillage Research*, 93, 412-419. https://doi.org/10.1016/j.still.2006.05.011
* Earl, R. (1997). Prediction of Trafficability and Workability from Soil Moisture Deficit. *Soil and Tillage Research*, 40, 155-168. https://doi.org/10.1016/S0167-1987(96)01072-0
* Eliasson, L. (2005). Effects of Forwarder Tyre Pressure on Rut Formation and Soil Compaction. *Silva Fennica*, 39, 549-557. https://doi.org/10.14214/sf.366
* Eliasson, L., & Wästerlund, I. (2007). Effects of Slash Reinforcement of Strip Roads on Rutting and Soil Compaction on a Moist Fine-Grained Soil. *Forest Ecology and Management*, 252, 118-123. https://doi.org/10.1016/j.foreco.2007.06.037
* Farzaneh, B., Almassi, M., Sadeghi, M., & Minaei, S. (2012). Assessment of Soil Compaction Bulk Density Indices and Cone Index in Different Moistures and Depths for Application in Precise Tillage. *World Applied Sciences Journal*, 20, 1704-1712.
* Furze, S. (2018). *A High-Resolution Digital Soil Mapping Framework for New Brunswick, Canada* (221 pp.). New Brunswick: University of New Brunswick.
* Furze, S. (2019). *Digital Soil Maps for New Brunswick* (WWW Document).
* GeoNB (2015). *GIS Bare-Earth Digital Elevation Model*. Fredericton, NB: Service New Brunswick.
* Giannetti, F., Chirici, G., Travaglini, D., Bottalico, F., Marchi, E., & Cambi, M. (2017). Assessment of Soil Disturbance Caused by Forest Operations by Means of Portable Laser Scanner and Soil Physical Parameters. *Soil Science Society of America Journal*, 81, 1577-1585. https://doi.org/10.2136/sssaj2017.02.0051
* Grigal, D. F. (2000). Effects of Extensive Forest Management on Soil Productivity. *Forest Ecology and Management*, 138, 167-185. https://doi.org/10.1016/S0378-1127(00)00395-9
* Haas, J., Ellhöft, K. H., Schack-Kirchner, H., & Lang, F. (2016). Using Photogrammetry to Assess Rutting Caused by a Forwarder—A Comparison of Different Tires and Bogie Tracks. *Soil & Tillage Research*, 163, 14-20. https://doi.org/10.1016/j.still.2016.04.008
* Horn, R., Vossbrink, J., & Becker, S. (2004). Modern Forestry Vehicles and Their Impacts on Soil Physical Properties. *Soil and Tillage Research*, 79, 207-219. https://doi.org/10.1016/j.still.2004.07.009
* Jones, M. F., & Arp, P. A. (2017). Relating the Cone Penetration and Rutting Resistance of Soils to Variations in Soil Properties and Daily Moisture Variations over Time. *Open Journal of Soil Science*, 7, 149-171. https://doi.org/10.4236/ojss.2017.77012
* Jones, M. F., & Arp, P. A. (2019). Analyzing and Projecting Soil Moisture and Cone Penetrability Variations in Forest Soils. *Open Journal of Forestry*, 9, 109-142. https://doi.org/10.4236/ojf.2019.92005
* Jones, M. F., Castonguay, M., Jaeger, D., & Arp, P. A. (2018). Track-Monitoring and Analyzing Machine Clearances during Wood Forwarding. *Open Journal of Forestry*, 8, 297-327. https://doi.org/10.4236/ojf.2018.83020
* Jun, H. G., Way, T. R., Löfgren, B., Landström, M., Bailey, A. C., Burt, E. C., & McDonald, T. P. (2004). Dynamic Load and Inflation Pressure Effects on Contact Pressures of a Forestry Forwarder Tire. *Journal of Terramechanics*, 41, 209-222. https://doi.org/10.1016/j.jterra.2004.03.002
* Jutras, M. F. (2012). *Modeling Stream Discharge in Forest Catchments across Canada: Hydraulic Conductivity Calibrations* (146 pp.). New Brunswick: University of New Brunswick.
* Kohavi, R. (1995). A Study of Cross-Validation and Bootstrap for Accuracy Estimation and Model Selection. *International Joint Conference on Artificial Intelligence*, 14, 1137-1145.
* Kumar, A., Chen, Y., Sadek, A., & Rahman, S. (2012). Soil Cone Index in Relation to Soil Texture, Moisture Content, and Bulk Density for No-Tillage and Conventional Tillage. *Agricultural Engineering International*, 14, 26-37.
* Labelle, E. R., Jaeger, D., & Poltorak, B. J. (2015). Assessing the Ability of Hardwood and Softwood Brush Mats to Distribute Applied Loads. *Croatian Journal of Forest Engineering*, 36, 227-242.
* Launiainen, S., Ala-Ilomäki, J., Hiedanpää, J., Salmivaara, A., Finér, L., Nevalainen, P., Heikkonen, J., & Pahikkala, T. (2017). Estimating the Rut Depth by UAV Photogrammetry. *Remote Sensing*, 9, 1279. https://doi.org/10.3390/rs9121279
* Maclaurin, E. B. (1990). The Use of Mobility Numbers to Describe the in-Field Tractive Performance of Pneumatic Tyres. In *Proceedings of the 10th International ISTVS Conference* (pp. 177-186). Kobe, Japan.
* McDonald, T., & Seixas, F. (1997). Effect of Slash on Forwarder Soil Compaction. *Journal of Forest Engineering*, 8, 15-26.
* McFero Grace, J., Skaggs, R. W., & Cassel, D. K. (2006). Soil Physical Changes Associated with Forest Harvesting Operations on an Organic Soil. *Soil Science Society of America Journal*, 70, 503-509. https://doi.org/10.2136/sssaj2005.0154
* Meek, P. (1996). *Effects of Skidder Traffic on Two Types of Forest Soils*. Technical Report. Pointe-Claire, QC.
* Murphy, P. N. C., Castonguay, M., Ogilvie, J., Nasr, M., Hazlett, P., Bhatti, J. S., & Arp, P. A. (2009). A Geospatial and Temporal Framework for Modeling Gaseous N and Other N Losses from Forest Soils and Basins, with Application to the Turkey Lakes Watershed Project, in Ontario, Canada. *Forest Ecology and Management*, 258, 2304-2317. https://doi.org/10.1016/j.foreco.2008.12.006
* Murphy, P. N. C., Ogilvie, J., Meng, F. R., White, B., Bhatti, J. S., & Arp, P. A. (2011). Modelling and Mapping Topographic Variations in Forest Soils at High Resolution: A Case Study. *Ecological Modelling*, 222, 2314-2332. https://doi.org/10.1016/j.ecolmodel.2011.01.003
* Naghdi, R., Bagheri, I., Lotfalian, M., & Setodeh, B. (2009). Rutting and Soil Displacement Caused by 450C Timber Jack Wheeled Skidder (Asalem Forest Northern Iran). *Journal of Forest Science*, 55, 177-183. https://doi.org/10.17221/102/2008-JFS
* Nikooy, M., Tsioras, P. A., Naghdi, R., Zenner, E. K., & Solgi, A. (2016). Soil Disturbance Caused by Ground-Based Skidding at Different Soil Moisture Conditions in Northern Iran. *International Journal of Forest Engineering*, 27, 169-178. https://doi.org/10.1080/14942119.2016.1234196
* Page-Dumroese, D., Jurgensen, M., Elliot, W., Rice, T., Nesser, J., Collins, T., & Meurisse, R. (2000). Soil Quality Standards and Guidelines for Forest Sustainability in Northwestern North America. *Forest Ecology and Management*, 138, 445-462. https://doi.org/10.1016/S0378-1127(00)00430-8
* Pierzchała, M., Talbot, B., & Astrup, R. (2016). Measuring Wheel Ruts with Close-Range Photogrammetry. *Forestry: An International Journal of Forest Research*, 89, 383-391. https://doi.org/10.1093/forestry/cpw009
* Poltorak, B. J., Labelle, E. R., & Jaeger, D. (2018). Soil Displacement during Ground-Based Mechanized Forest Operations Using Mixed-Wood Brush Mats. *Soil and Tillage Research*, 179, 96-104. https://doi.org/10.1016/j.still.2018.02.005
* R Core Team (2015). *R: A Language and Environment for Statistical Computing*. Vienna, Austria.
* Rantala, M. (2001). *Comparison of Some Measurement Methods for Predicting the Site Sensitivity (Rut Formation) in the Practical Harvesting of Wood* (pp. 5-8). ECOWOOD.
* Raper, R. L. (2005). Agricultural Traffic Impacts on Soil. *Journal of Terramechanics*, 42, 259-280. https://doi.org/10.1016/j.jterra.2004.10.010
* Raper, R. L., Bailey, A. C., Burt, E. C., Way, T. R., & Liberati, P. (1995). The Effects of Reduced Inflation Pressure on Soil-Tire Interface Stresses and Soil Strength. *Journal of Terramechanics*, 32, 43-51. https://doi.org/10.1016/0022-4898(95)00002-1
* Saarilahti, M. (2002a). *Soil Interaction Model*. Helsinki, Finland.
* Saarilahti, M. (2002b). *Soil Interaction Model—Development of a Protocol for Ecoefficient Wood Harvesting on Sensitive Sites (Ecowood)*—Appendix No. 8.
* Saarilahti, M., & Anttila, T. (1999). Rut Depth Model for Timber Transport of Moraine Soils. In *Proceedings of the 9th International Conference of International Society for Terrain-Vehicle Systems* (pp. 29-37). Barcelona, Spain: Barcelona Congress Hall.
* Sakai, H., Nordfjell, T., Suadicani, K., Talbot, B., & Bøllehuus, E. (2008). Soil Compaction on Forest Soils from Different Kinds of Tires and Tracks and Possibility of Accurate Estimate. *Croatian Journal of Forest Engineering*, 29, 15-27.
* Salmivaara, A., Miettinen, M., Finér, L., Launiainen, S., Korpunen, H., Tuominen, S., Heikkonen, J., Nevalainen, P., Sirén, M., Ala-Ilomäki, J., & Uusitalo, J. (2018). Wheel Rut Measurements by Forest Machine-Mounted LiDAR Sensors—Accuracy and Potential for Operational Applications? *International Journal of Forest Engineering*, 29, 41-52. https://doi.org/10.1080/14942119.2018.1419677
* Scholander, J. (1974). Bearing Capacity of Some Forest Soils for Wheeled Vehicles. Some Technical Aspects and Consequences. *Skogsmarks bärighet för hjulfordon. Några tekniska aspekter och konsekvenser*. Specialnotiser från SFM Nr 14.
* Singer, M. J., & Munns, D. N. (2006). *Soils: An Introduction* (6th ed.). Columbus, OH: Pearson Prentice Hall.
* Sirén, M., Ala-Ilomäki, J., Lindeman, H., Uusitalo, J., Kiilo, K., Salmivaara, A., & Ryynänen, A. (2019). Soil Disturbance by Cut-to-Length Machinery on Mid-Grained Soils. *Silva Fennica*, 53, 1-24. https://doi.org/10.14214/sf.10134
* Sutherland, B. J. (2003). *Preventing Soil Compaction and Rutting in the Boreal Forest of Western Canada: A Practical Guide to Operating Timber-Harvesting Equipment*. Pointe-Claire, QC.
* Taghavifar, H., & Mardani, A. (2014). Effect of Velocity, Wheel Load and Multipass on Soil Compaction. *Journal of the Saudi Society of Agricultural Sciences*, 13, 57-66. https://doi.org/10.1016/j.jssas.2013.01.004
* Tekeste, M. Z., Raper, R. L., & Schwab, E. B. (2008). Soil Drying Effects on Soil Strength and Depth of Hardpan Layers as Determined from Cone Index Data. *Agricultural Engineering International: The CIGR Ejournal*, 10, 1-17.
* Van Rees, K. (2002). *Regulations and Guidelines for Soil Disturbance across Canada*.
* Vaz, C. M. P. (2003). *Use of a Combined Penetrometer-TDR Moisture Probe for Soil Compaction Studies*. College on Soil Physics.
* Vaz, C. M. P., Manieri, J. M., de Maria, I. C., & Tuller, M. (2011). Modeling and Correction of Soil Penetration Resistance for Varying Soil Water Content. *Geoderma*, 166, 92-101. https://doi.org/10.1016/j.geoderma.2011.07.016
* Vega-Nieva, D. J. D., Murphy, P. N. C., Castonguay, M., Ogilvie, J., & Arp, P. A. (2009). A Modular Terrain Model for Daily Variations in Machine-Specific Forest Soil Trafficability. *Canadian Journal of Soil Science*, 89, 93-109. https://doi.org/10.4141/CJSS06033
* White, B., Ogilvie, J., Campbell, D. M. H., Hiltz, D., Gauthier, B., Chisholm, H. K. H., Wen, H. K., Murphy, P. N. C., & Arp, P. A. (2012). Using the Cartographic Depth-to-Water Index to Locate Small Streams and Associated Wet Areas across Landscapes. *Canadian Water Resources Journal*, 37, 333-347. https://doi.org/10.4296/cwrj2011-909
* Yin, X., & Arp, P. A. (1994). Fog Contributions to the Water Budget of Forested Watersheds in the Canadian Maritime Provinces: A Generalized Algorithm for Low Elevations. *Atmosphere-Ocean*, 32, 553-566. https://doi.org/10.1080/07055900.1994.9649512

---

## Appendix

### Appendix 1. Rut Depth Severity Classes

| Photo Example | Description |
| :---: | :--- |
| *(Photo 1)* | **Minimal ruts ($0 - 5\text{ cm}$)**<br>Minor surface abrasions, slight forest floor disturbance, little visible soil damage/root scuffing |
| *(Photo 2)* | **Shallow ruts ($5 - 10\text{ cm}$)**<br>Visible ruts, potential water retention, minimal effects on roots and soil productivity |
| *(Photo 3)* | **Moderate ruts ($10 - 20\text{ cm}$)**<br>Visible soil disturbance, potential water retention, mineral soil exposed |
| *(Photo 4)* | **Deep ruts ($20 - 40\text{ cm}$)**<br>Damage to roots, generally thick organic layers, exposed mineral soil |
| *(Photo 5)* | **Extreme ruts ($40+\text{ cm}$)**<br>Generally found in wet areas, high organic matter, machine loading zones |

*(Figure A1: Rut depth severity classes.)*

### Appendix 2. Temporal Soil Moisture Modelling

The Forest Hydrology Model (ForHyM) uses daily temperature and precipitation (rain and snow) data as well as block-specific area, vegetation, soil horizon texture, depth, $OM$, and $CF$ (**Table A1**) to predict soil moisture and temperature fluctuations through the soil (Arp & Yin, 1992; Yin & Arp, 1994; Jutras, 2012). Calibrating ForHyM consists of comparing actual snowpack and hydraulic flow to modelled outputs and adjusting the output parameters (**Table A2**, **Figure A2**).

**Table A1.** Soil profile and vegetation information used to initialize ForHyM for each block.

| Vegetation / Block | Layer | Depth ($\text{cm}$) | Texture | $OM$ ($\%$) | $CF$ ($\%$) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **1**<br>INHW, deep rooted | LFH | 5 | Organic | 100 | 0 |
| | A | 25 | SL | 15 | 20 |
| | B | 50 | SL | 5 | 20 |
| | C | 100 | SL | 1 | 35 |
| **2**<br>SW, shallow rooted | LFH | 10 | Organic | 100 | 0 |
| | A | 10 | LS | 2 | 20 |
| | B | 50 | LS | 10 | 24 |
| | C | 100 | SL | 1 | 35 |
| **3**<br>SW, shallow rooted | LFH | 10 | Organic | 100 | 0 |
| | A | 10 | LS | 2 | 20 |
| | B | 50 | LS | 10 | 24 |
| | C | 100 | SL | 1 | 35 |
| **9**<br>TOHW, deep rooted | LFH | 5 | Organic | 100 | 0 |
| | A | 10 | LS | 8 | 20 |
| | B | 55 | LS | 5 | 20 |
| | C | 150 | SL | 1 | 25 |

**Table A2.** ForHyM calibrations pertaining to snowpack and soil permeability across Blocks 1 to 3 and 9.

| Parameter Category | Parameter | Blocks 1 - 3 | Block 9 |
| :--- | :--- | :---: | :---: |
| **Snowpack Density** | Snow-to-air temperature gradient | 0.16 | 0.2 |
| | Density of fresh snow | 0.16 | 0.2 |
| **Saturated Soil Permeability Multiplier** | Surface runoff | 1 | 1 |
| | Forest floor infiltration | 1 | 1 |
| | Forest floor interflow | 0.01 | 0.01 |
| | A & B horizon infiltration | 1 | 1 |
| | A & B horizon interflow | 0.05 | 0.01 |
| | C horizon infiltration | 1 | 1 |
| | C horizon interflow | 0.1 | 0.5 |
| | Deep water percolation | 1 | 1 |

*(Figure A2: Modelled vs measured ForHyM generated calibration outputs for snowpack and stream discharge for Blocks 1 to 3 (top) and Block 4 (bottom).)*

---

## Equation Verification & Notes

During the conversion, the mathematical equations and tabular parameters were verified against the cited literature and standard terramechanics formulations:

1. **Table 1 (Maclaurin, 1990):** The OCR read $NCI^{129}$, which is a known OCR misread of the original exponent $1.25$ in Maclaurin's formulation ($Z = d \times \frac{0.224}{NCI^{1.25}}$).
2. **Table 1 (Scholander, 1974):** The OCR read $n^{\frac{n}{n}}$. Scholander's multi-pass sinkage formula is $Z_n = Z_1 \times n^{1/a}$, where $a$ is the multi-pass compaction coefficient.
3. **Table 1 (Saarilahti, 2002a):** The OCR read $Z_a = (Z_{a-1}^{a_a} + Z_i^{o_a})^{\frac{1}{a_a}}$. This has been restored to Saarilahti's recursive multi-pass equation: $Z_n = \left( Z_{n-1}^{a_n} + Z_1^{a_n} \right)^{\frac{1}{a_n}}$.
4. **Table 1 (Vega-Nieva et al., 2009):** The OCR distorted the exponent of $n$. Verified against Vega-Nieva et al. (2009), the multi-pass equation is $Z_n = \frac{r_1}{NCI} n^{\frac{1}{(p_1 NCI^{p_2})}} (1 - CF)^2$.
5. **Table 1 (Sirén et al., 2019):** Restored missing equals sign and subscripts from OCR: $\log Z = b_0 + b_1 M + b_2 MC_v + b_3 CI + u_{sc} + e_{sc}$.
6. **Equation (1):** Restored the calibration parameter $p_{mc}$ and subscript $top$ ($MC_{PS,top}$ and $DTW_{top}$) which were garbled in OCR as $MC_{pS,op}$, $DTW_{iop}$, and $p_c$.
7. **Equation (4):** Verified against standard Wismer-Luth / Saarilahti nominal cone index ($NCI$) formulations for forestry tires: $NCI = \frac{1000 CI d b}{W} \sqrt{\frac{\delta}{h}} \frac{1}{1 + b / (2d)}$, where $\delta$ is tire deflection.
8. **Equations (5) & (7):** Restored the exponent structure $Passes^{0.071 \times NCI_{adj}}$ and verified its correspondence with the non-linear regression parameter $b = 0.072 \pm 0.007$ in **Table 7**.
9. **Table 7:** In the original paper's Multiple Regression section, the authors inadvertently swapped the values between the `Regr.` (regression coefficient) and `±SE` (standard error) columns for several rows (e.g., listing the intercept as $6.326 \pm 70.883$, whereas Equation (2) shows the intercept is $70.88$). In the Markdown table above, all coefficients and standard errors have been aligned into their proper columns and verified against the $t$-values ($\text{Regr.} / \text{SE} \approx t\text{-value}$) and Equations (2)–(5).